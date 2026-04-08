const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const FIREBASE_URL = process.env.FIREBASE_URL;

const orderStates = {}; 

async function getMenuFromApp() {
    try {
        const response = await fetch(`${FIREBASE_URL}/dishes.json`);
        const data = await response.json();
        if (!data) return[];
        
        return Object.keys(data).map(key => ({
            id: key,
            name: data[key].name,
            price: data[key].price,
            imageUrl: data[key].imageUrl
        }));
    } catch (error) {
        console.error("Failed to fetch menu:", error);
        return[];
    }
}

async function startBot() {
    if (!FIREBASE_URL) {
        console.log("❌ ERROR: FIREBASE_URL missing!");
        process.exit(1);
    }

    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser:["D","Z","1"] 
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.clear(); 
            console.log('\nScan QR Code:\n');
            qrcode.generate(qr, { small: true }); 
        }

        if (connection === 'open') console.log('✅ DIGITAL ZONE BOT IS ONLINE!');
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase();

        console.log(`📩 ${text}`);

        // COMPLETE ORDER
        if (orderStates[sender]?.step === 'WAITING_FOR_ADDRESS') {
            const customerDetails = text;
            const item = orderStates[sender].item;
            const customerWaNumber = sender.split('@')[0];

            const orderData = {
                userId: "whatsapp_" + customerWaNumber,
                phone: customerWaNumber,
                address: customerDetails,
                items:[{
                    id: item.id,
                    name: item.name,
                    price: parseFloat(item.price),
                    img: item.imageUrl || "",
                    quantity: 1
                }],
                total: (parseFloat(item.price) + 100).toFixed(2),
                status: "Placed",
                method: "Cash on Delivery",
                timestamp: new Date().toISOString()
            };

            try {
                await fetch(`${FIREBASE_URL}/orders.json`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(orderData)
                });
            } catch (error) {
                console.log("Firebase Error: ", error);
            }

            await sock.sendMessage(sender, { 
                text: `✅ *Order Confirmed!*\n\nItem: *${item.name}*\nTotal: Rs ${orderData.total}\n\nYour order is being processed 🚀\n\nThank you for choosing *Digital Zone* 💙`
            });

            delete orderStates[sender]; 
            return;
        }

        // START ORDER
        if (text.startsWith("order ")) {
            const productRequested = text.replace("order ", "").trim().toLowerCase();
            const currentMenu = await getMenuFromApp();
            
            const matchedItem = currentMenu.find(item => item.name.toLowerCase().includes(productRequested));

            if (!matchedItem) {
                await sock.sendMessage(sender, { text: `❌ Item not found.\nType *menu* to see available items.` });
                return;
            }

            orderStates[sender] = { step: 'WAITING_FOR_ADDRESS', item: matchedItem };
            
            const captionText = `🛒 *Order Started*\n\nItem: *${matchedItem.name}*\nPrice: Rs ${matchedItem.price}\n\nSend your *Name + Phone + Address*`;

            if (matchedItem.imageUrl) {
                await sock.sendMessage(sender, { 
                    image: { url: matchedItem.imageUrl }, 
                    caption: captionText 
                });
            } else {
                await sock.sendMessage(sender, { text: captionText });
            }
        }

        else if (text === "order") { 
            await sock.sendMessage(sender, { text: "🛒 Type: order item_name\nExample: order pizza" });
        }

        // MENU
        else if (text.includes("menu")) {
            const currentMenu = await getMenuFromApp();
            
            if (currentMenu.length === 0) {
                await sock.sendMessage(sender, { text: "Menu unavailable." });
                return;
            }

            let menuMessage = "📋 *DIGITAL ZONE MENU*\n\n";
            currentMenu.forEach(item => {
                menuMessage += `🔹 ${item.name} - Rs ${item.price}\n`;
            });

            menuMessage += "\nReply: order item_name";

            await sock.sendMessage(sender, { text: menuMessage });
        }

        // GREETING
        else if (text.includes("hi") || text.includes("hello")) {
            await sock.sendMessage(sender, { 
                text: "👋 *Welcome to Digital Zone*\n\n1️⃣ View Menu\n2️⃣ Contact Support\n\nReply with number"
            });
        }

        // NUMBER SYSTEM
        else if (text === "1") {
            const currentMenu = await getMenuFromApp();
            let menuMessage = "📋 *DIGITAL ZONE MENU*\n\n";
            currentMenu.forEach(item => {
                menuMessage += `🔹 ${item.name} - Rs ${item.price}\n`;
            });
            await sock.sendMessage(sender, { text: menuMessage });
        }

        else if (text === "2") {
            await sock.sendMessage(sender, { 
                text: "📞 *Digital Zone Support*\n\n📱 WhatsApp: https://wa.me/923405061980\n⏰ Available: 24/7"
            });
        }

        // CONTACT
        else if (text.includes("contact")) {
            await sock.sendMessage(sender, { 
                text: "📞 *Digital Zone Support*\n\n📱 WhatsApp: https://wa.me/923405061980\n⏰ Available: 24/7"
            });
        }

        else {
            await sock.sendMessage(sender, { 
                text: "❓ Type *menu* or *hi* to start"
            });
        }
    });
}

startBot();
