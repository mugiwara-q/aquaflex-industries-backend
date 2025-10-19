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

// Increase payload size limit for JSON and URL-encoded data
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Health check route
app.get("/", (req, res) => {
    res.json({
        status: "ok",
        times: new Date().toISOString(),
        timestamp: new Date().toLocaleString(),
        /* environment: process.env.NODE_ENV || 'development' */
    })
})

// Telegram Bot setup
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const bot = new TelegramBot(token, {
    request: {
        timeout: 30000, // 30 seconds timeout
        proxy: process.env.HTTPS_PROXY || process.env.HTTP_PROXY,
        pool: { maxSockets: 10 }
    }
});

// Function to retry failed operations
async function retry(fn, retries = 3, delay = 1000) {
    try {
        return await fn();
    } catch (error) {
        if (retries <= 0) throw error;
        await new Promise(resolve => setTimeout(resolve, delay));
        return retry(fn, retries - 1, delay * 2);
    }
}

// Configure multer with error handling and file size limits
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir)
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    }
});

// Multer error handling middleware
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'Le fichier est trop volumineux. La taille maximum est de 50 MB.'
            });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                message: 'Trop de fichiers. Maximum 10 fichiers autorisés.'
            });
        }
        return res.status(400).json({
            success: false,
            message: `Erreur lors de l'upload: ${err.message}`
        });
    }
    next(err);
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
        files: 10 // Maximum 10 files
    },
    fileFilter: (req, file, cb) => {
        // Vérifier les types de fichiers autorisés
        const allowedTypes = ['model/stl', 'application/sla', 'model/obj', 
                            'application/octet-stream', // Pour les fichiers STL binaires
                            'text/plain']; // Pour les fichiers STL ASCII
        
        if (allowedTypes.includes(file.mimetype) || 
            file.originalname.toLowerCase().endsWith('.stl') ||
            file.originalname.toLowerCase().endsWith('.obj')) {
            cb(null, true);
        } else {
            cb(new Error('Type de fichier non supporté. Seuls les fichiers STL et OBJ sont acceptés.'));
        }
    }
});

// Routes
// Ajouter le middleware de gestion d'erreur Multer après les routes
app.use(handleMulterError);

app.post('/3d-quote', upload.array('files'), async (req, res) => {
    try {
        const { firstName, lastName, email } = req.body;
        const files = req.files;
        const jobsData = JSON.parse(req.body.jobs);

        // Function to escape special characters for Markdown
        const escapeMarkdown = (text) => {
            return text.replace(/[_*\[\]()~`>#+=|{}.!-]/g, '\\$&');
        };

        let caption = `*📋 DEMANDE DEVIS IMPRESSION 3D*\n\n`;
        caption += `*👤 Contact*\n`;
        caption += `*Nom:* ${escapeMarkdown(`${firstName} ${lastName}`)}\n`;
        caption += `*Email:* ${escapeMarkdown(email)}\n\n`;
        caption += `*📁 Fichiers [${jobsData.length}]*\n\n`;

        jobsData.forEach((job, index) => {
            caption += `*[${index + 1}] ${escapeMarkdown(job.filename)}*\n`;
            caption += `▫️ Matériau: ${escapeMarkdown(job.material)}\n`;
            caption += `▫️ Quantité: ${job.quantity}\n`;
            caption += `▫️ Hauteur de couche: ${escapeMarkdown(job.layerHeight)}\n`;
            caption += `▫️ Remplissage: ${escapeMarkdown(job.infill)}\n`;
            caption += `▫️ Couleur: ${escapeMarkdown(job.color)}\n`;
            caption += `▫️ Volume estimé: ${job.volume.toFixed(2)} cm³\n`;
            caption += `▫️ Urgence: ${job.urgency === 'urgent' ? '⚠️ URGENT' : 'Standard'}\n`;
            caption += `▫️ Prix estimé: ${job.price.toFixed(2)}€\n\n`;
        });

        caption += `*💰 Prix total indicatif: ${jobsData.reduce((acc, job) => acc + job.price, 0).toFixed(2)}€*\n\n`;

        if (req.body.notes) {
            caption += `*📝 Notes:*\n${escapeMarkdown(req.body.notes)}`;
        }

        await retry(() => bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' }));

        // Send each 3D file
        for (const file of files) {
            try {
                await retry(async () => {
                    await bot.sendDocument(chatId, file.path, {}, {
                        filename: file.originalname,
                        contentType: file.mimetype,
                    });
                });
            } catch (error) {
                console.error(`Failed to send file ${file.originalname}:`, error);
                throw error;
            } finally {
                // Clean up the uploaded file even if sending fails
                try {
                    if (fs.existsSync(file.path)) {
                        fs.unlinkSync(file.path);
                    }
                } catch (unlinkError) {
                    console.error(`Failed to clean up file ${file.path}:`, unlinkError);
                }
            }
        }

        res.status(200).json({ success: true, message: '3D quote request sent successfully.' });
    } catch (error) {
        console.error('Error sending 3D quote request to Telegram:', error);
        res.status(500).json({ success: false, message: 'Failed to send 3D quote request.' });
    }
});

app.post('/quote', upload.single('file'), async (req, res) => {
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