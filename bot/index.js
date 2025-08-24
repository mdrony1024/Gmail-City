const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// --- INITIALIZATION ---
// Load credentials from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
const adminPanelUrl = process.env.ADMIN_PANEL_URL;
const adminPanelSecretKey = process.env.ADMIN_PANEL_SECRET_KEY;
const botUsername = process.env.BOT_USERNAME;

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Initialize Telegram Bot
const bot = new TelegramBot(token, { polling: true });
console.log('Bot has been started...');

// --- HELPER FUNCTIONS ---
const isAdmin = async (userId) => {
    try {
        const adminsDoc = await db.collection('settings').doc('admins').get();
        if (adminsDoc.exists) {
            const adminIds = adminsDoc.data().adminIds || [];
            return adminIds.includes(userId);
        }
        return false;
    } catch (error) {
        console.error("Error checking admin status:", error);
        return false;
    }
};

// --- USER COMMANDS ---

// /start command (handles new users and referrals)
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const newUserId = msg.from.id.toString();
    const referrerId = match ? match[1] : null;

    const newUserRef = db.collection('users').doc(newUserId);
    const doc = await newUserRef.get();

    if (!doc.exists) {
        await newUserRef.set({
            username: msg.from.username || msg.from.first_name,
            balance: 0,
            approvedCount: 0,
            rejectedCount: 0,
            referredBy: referrerId
        }, { merge: true });
        bot.sendMessage(chatId, 'Welcome to the bot! You can now submit your Gmail addresses.');
        if (referrerId) {
            bot.sendMessage(referrerId, `A new user, ${msg.from.username || 'user'}, has joined using your referral link!`);
        }
    } else {
        bot.sendMessage(chatId, 'Welcome back!');
    }
});

// /history command
bot.onText(/\/history/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();

    if (!doc.exists) {
        return bot.sendMessage(chatId, "You don't have an account yet. Use /start to begin.");
    }

    const userData = doc.data();
    const message = `
📊 Your History 📊

💰 Total Income: ${userData.balance || 0} BDT
✅ Approved Submissions: ${userData.approvedCount || 0}
❌ Rejected Submissions: ${userData.rejectedCount || 0}
    `;
    bot.sendMessage(chatId, message);
});

// /refer command
bot.onText(/\/refer/, (msg) => {
    const referralLink = `https://t.me/${botUsername}?start=${msg.from.id}`;
    bot.sendMessage(msg.chat.id, `Share this link with your friends:\n\n${referralLink}`);
});

// --- GMAIL SUBMISSION ---
bot.on('message', async (msg) => {
    const text = msg.text;
    const chatId = msg.chat.id;

    const emailRegex = /^[a-zA-Z0-9._-]+@gmail\.com$/;
    if (text && emailRegex.test(text) && !text.startsWith('/')) {
        await db.collection('gmails').add({
            gmailAddress: text,
            submittedBy: msg.from.id.toString(),
            status: 'pending',
            submissionDate: new Date()
        });
        bot.sendMessage(chatId, `✅ Your submission for (${text}) has been received and is awaiting review.`);
    }
});

// --- ADMIN COMMANDS ---

// Secret command for admins to get the panel link
bot.onText(/\/apanel_(.+)/, async (msg, match) => {
    const secretKey = match[1];
    if (secretKey !== adminPanelSecretKey) return;
    
    if (await isAdmin(msg.from.id)) {
        const opts = {
            reply_markup: {
                inline_keyboard: [[{ text: '🔓 Open Admin Panel', web_app: { url: adminPanelUrl } }]]
            }
        };
        bot.sendMessage(msg.chat.id, '✅ Access Granted. Opening Admin Panel...', opts);
    }
});

// /broadcast command for admins
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    if (!(await isAdmin(msg.from.id))) return;

    const broadcastMessage = match[1];
    const usersSnapshot = await db.collection('users').get();
    
    let successCount = 0;
    for (const doc of usersSnapshot.docs) {
        try {
            await bot.sendMessage(doc.id, broadcastMessage);
            successCount++;
        } catch (error) {
            console.log(`Failed to send message to user ${doc.id}: ${error.message}`);
        }
    }
    bot.sendMessage(msg.chat.id, `📢 Broadcast sent to ${successCount} users.`);
});


// --- REAL-TIME NOTIFICATIONS on Approve/Reject ---
// Listen for changes in the 'gmails' collection
db.collection('gmails').where('status', '!=', 'pending').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
        // We only care about newly modified documents
        if (change.type === 'modified') {
            const gmailData = change.doc.data();
            const oldData = change.doc._document.proto.fields; // Accessing previous state is complex, better to check status
            
            // This logic assumes the status was 'pending' before
            const userId = gmailData.submittedBy;
            const status = gmailData.status; // 'approved' or 'rejected'
            const gmailAddress = gmailData.gmailAddress;
            let message = '';
            
            if (status === 'approved') {
                message = `🎉 Congratulations! Your submission for "${gmailAddress}" has been approved.`;
            } else if (status === 'rejected') {
                message = `😞 Unfortunately, your submission for "${gmailAddress}" has been rejected.`;
            }

            if (message) {
                 bot.sendMessage(userId, message).catch(err => console.log(`Could not send notification to ${userId}: ${err.message}`));
            }
        }
    });
});
