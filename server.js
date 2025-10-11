const express = require('express');
const multer = require('multer');
const TelegramBot = require('node-telegram-bot-api');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config();

// Check required environment variables
if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.error('Required environment variables are missing');
    process.exit(1);
}

const app = express();
const port = process.env.BACKEND_PORT || 3000;

// Middleware
app.use(cors({
    "origin": "*",
    "methods": "GET,POST,",
    "preflightContinue": false,
    "optionsSuccessStatus": 204
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check route
app.get("/", (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Telegram Bot setup
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const bot = new TelegramBot(token);

// Multer setup for file uploads
const upload = multer({ dest: 'uploads/' });

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Routes
app.post('/api/3d-quote', upload.array('files'), async (req, res) => {
    try {
        const { firstName, lastName, email } = req.body;
        const files = req.files;
        const jobsData = JSON.parse(req.body.jobs);

        let caption = `
      *DEMANDE DEVIS IMPRESSION 3D*

      *Contact*
      👤 Nom: ${firstName} ${lastName}
      📧 Email: ${email}

      *Fichiers : [${jobsData.length}]*   
      ${jobsData.map((job, index) => `
        ${index + 1}. ${job.filename}
        - Matériau: ${job.material}
        - Quantité: ${job.quantity}
        - Hauteur de couche: ${job.layerHeight}
        - Remplissage: ${job.infill}
        - Couleur: ${job.color}
        - Volume estimé: ${job.volume.toFixed(2)} cm³
        - Urgence : ${job.urgency === 'urgent' ? '⚠️ URGENT' : 'NON URGENT'}
        - Prix estimé: ${job.price.toFixed(2)}€
      `).join('\n')}

      *Prix total indicatif: ${jobsData.reduce((acc, job) => acc + job.price, 0).toFixed(2)}€*

      ${req.body.notes ? `*Notes:*\n${req.body.notes}` : ''}
    `;

        await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });

        // Send each 3D file
        for (const file of files) {
            await bot.sendDocument(chatId, file.path, {}, {
                filename: file.originalname,
                contentType: file.mimetype,
            });
            // Clean up the uploaded file
            fs.unlinkSync(file.path);
        }

        res.status(200).json({ success: true, message: '3D quote request sent successfully.' });
    } catch (error) {
        console.error('Error sending 3D quote request to Telegram:', error);
        res.status(500).json({ success: false, message: 'Failed to send 3D quote request.' });
    }
});

app.post('/api/quote', upload.single('file'), async (req, res) => {
    try {
        const { name, company, email, phone, message } = req.body;
        const file = req.file;

        let caption = `
      *DEMANDE DEVIS PROJET*

      *Nom:* ${name}
      *Entreprise:* ${company || 'N/A'}
      *Email:* ${email}
      *Téléphone:* ${phone || 'N/A'}

      *Message:*
      ${message}
    `;

        await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });

        if (file) {
            await bot.sendDocument(chatId, file.path, {}, {
                filename: file.originalname,
                contentType: file.mimetype,
            });
            // Clean up the uploaded file
            fs.unlinkSync(file.path);
        }

        res.status(200).json({ success: true, message: 'Quote request sent successfully.' });
    } catch (error) {
        console.error('Error sending quote request to Telegram:', error);
        res.status(500).json({ success: false, message: 'Failed to send quote request.' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Une erreur est survenue sur le serveur.'
    });
});

// 404 handler - must be last route
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route non trouvée'
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port} !`);
    console.log(`API URL: http://localhost:${port}`);
});