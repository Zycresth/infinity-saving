    // ======================= DATA GLOBAL =======================
let targets = [];
let transactions = [];
let currentUser = null;
let settings = {
    theme: 'dark',
    currency: 'IDR',
    layoutMode: 'grid' // 'grid' for snap-to-grid, 'freeform' for custom positioning
};
// Performance optimization variables
let saveTimeout = null;
const DEBOUNCE_DELAY = 500;
let animationFrameId = null;
let langChangeTimeout = null;
let currencyChangeTimeout = null;
let pendingSaveData = null;

    const ACCOUNTS_KEY = 'nabung_accounts';
    const APP_STATE_KEY = 'nabung_app_state';
    const MIN_PASS_LEN = 8;

    // Network/Proxy configuration for future Privacy Hardening
    const NETWORK_CONFIG = {
        proxyEnabled: false,
        proxyUrl: 'http://localhost:8080/proxy',
        customHeaders: {
            'X-Privacy-Mode': 'enabled'
        }
    };

    // Currency configuration
    const CURRENCY_CONFIG = {
        IDR: { symbol: 'Rp', locale: 'id-ID', decimal: 0 },
        USD: { symbol: '$', locale: 'en-US', decimal: 2 },
        EUR: { symbol: '€', locale: 'de-DE', decimal: 2 },
        JPY: { symbol: '¥', locale: 'ja-JP', decimal: 0 }
    };
    // Optimized bcrypt rounds for mobile performance (lower rounds = faster on mobile)
    // Using 8 rounds instead of 10 for better mobile performance while maintaining security
    const BCRYPT_ROUNDS = 8;
    
    // Performance optimization: Cache bcrypt instance to avoid repeated lookups
    let cachedBcrypt = null;
    
    function isBcryptHash(str) {
        return typeof str === 'string' && /^\$2[aby]\$\d{2}\$/.test(str);
    }
    function getBcrypt() {
        if (cachedBcrypt) return cachedBcrypt;
        if (typeof dcodeIO !== 'undefined' && dcodeIO.bcrypt) {
            cachedBcrypt = dcodeIO.bcrypt;
            return cachedBcrypt;
        }
        if (typeof bcrypt !== 'undefined') {
            cachedBcrypt = bcrypt;
            return cachedBcrypt;
        }
        return null;
    }
    function ensureBcryptLoaded() {
        return getBcrypt() !== null;
    }
    function bcryptHashAsync(plain) {
        return new Promise(function (resolve, reject) {
            const bc = getBcrypt();
            if (!bc) {
                reject(new Error('bcrypt not loaded'));
                return;
            }
            // Use async hashing with optimized rounds for mobile
            bc.hash(plain, BCRYPT_ROUNDS, function (err, hash) {
                if (err) reject(err);
                else resolve(hash);
            });
        });
    }
    function bcryptCompareAsync(plain, hash) {
        return new Promise(function (resolve, reject) {
            const bc = getBcrypt();
            if (!bc) {
                reject(new Error('bcrypt not loaded'));
                return;
            }
            bc.compare(plain, hash, function (err, res) {
                if (err) reject(err);
                else resolve(!!res);
            });
        });
    }
    function verifyStoredPasswordAsync(plain, stored) {
        if (isBcryptHash(stored)) {
            return bcryptCompareAsync(plain, stored);
        }
        return Promise.resolve(plain === stored);
    }

    function loadAccounts() {
        try {
            const raw = localStorage.getItem(ACCOUNTS_KEY);
            const list = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(list)) return [];
            return list.filter(function (a) {
                return a && typeof a === 'object' && typeof a.email === 'string' && typeof a.password === 'string';
            }).map(function (a) {
                return {
                    username: sanitizeTextInput(a.username || '', 64),
                    email: sanitizeEmailInput(a.email || ''),
                    password: String(a.password)
                };
            });
        } catch (e) { return []; }
    }
    function saveAccounts(accounts) {
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    }
    function emailHasAtValid(email) {
        const e = String(email).trim();
        if (!e.includes('@')) return false;
        const parts = e.split('@');
        if (parts.length !== 2) return false;
        if (parts[0].length === 0 || parts[1].length === 0) return false;
        // Basic domain validation
        const domain = parts[1];
        if (!domain.includes('.')) return false;
        const domainParts = domain.split('.');
        if (domainParts.length < 2) return false;
        if (domainParts[domainParts.length - 1].length < 2) return false;
        return true;
    }
    
    function validatePasswordStrength(password) {
        if (password.length < MIN_PASS_LEN) return false;
        // Check for at least one letter and one digit
        const hasLetter = /[a-zA-Z]/.test(password);
        const hasDigit = /[0-9]/.test(password);
        return hasLetter && hasDigit;
    }
    
    function validateNumericInput(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
        const num = parseFloat(value);
        if (isNaN(num)) return null;
        if (num < min || num > max) return null;
        return num;
    }
    
    // Simple XOR obfuscation for API keys (not true encryption, but better than plain text)
    function obfuscateApiKey(key) {
        if (!key) return '';
        const xorKey = 'infinity-saving-key';
        let result = '';
        for (let i = 0; i < key.length; i++) {
            result += String.fromCharCode(key.charCodeAt(i) ^ xorKey.charCodeAt(i % xorKey.length));
        }
        return btoa(result); // Base64 encode
    }
    
    function deobfuscateApiKey(obfuscated) {
        if (!obfuscated) return '';
        try {
            const xorKey = 'infinity-saving-key';
            const decoded = atob(obfuscated);
            let result = '';
            for (let i = 0; i < decoded.length; i++) {
                result += String.fromCharCode(decoded.charCodeAt(i) ^ xorKey.charCodeAt(i % xorKey.length));
            }
            return result;
        } catch (e) {
            return '';
        }
    }
    function userStorageKey(user) {
        if (!user) return null;
        if (user.isGuest) return '__guest__';
        return String(user.email).trim().toLowerCase();
    }
    function getVault() {
        try {
            const v = JSON.parse(localStorage.getItem(APP_STATE_KEY) || '{}');
            return v && typeof v === 'object' ? v : {};
        } catch (e) { return {}; }
    }
    function setVault(v) {
        localStorage.setItem(APP_STATE_KEY, JSON.stringify(v));
    }
    function syncVaultFromMemory() {
        if (!currentUser) return;
        const k = userStorageKey(currentUser);
        if (!k) return;
        const vault = getVault();
        vault[k] = { targets: targets.slice(), transactions: transactions.slice() };
        setVault(vault);
    }
    function loadVaultIntoMemory() {
        if (!currentUser) {
            targets = [];
            transactions = [];
            return;
        }
        const k = userStorageKey(currentUser);
        const vault = getVault();
        let block = vault[k];
        if (!block && !localStorage.getItem('nabung_migrated_legacy')) {
            const legT = localStorage.getItem('nabung_targets');
            const legTx = localStorage.getItem('nabung_transactions');
            if (legT || legTx) {
                block = {
                    targets: legT ? JSON.parse(legT) : [],
                    transactions: legTx ? JSON.parse(legTx) : []
                };
                vault[k] = block;
                setVault(vault);
                localStorage.removeItem('nabung_targets');
                localStorage.removeItem('nabung_transactions');
            }
            localStorage.setItem('nabung_migrated_legacy', '1');
        }
        if (!block) block = { targets: [], transactions: [] };
        block = normalizeVaultBlock(block);
        targets = block.targets;
        transactions = block.transactions;
    }

    const I18N = {
        id: {
            appTitle: 'Infinity Saving - Wujudkan Mimpimu',
            loadingTagline: '\u2726 Mengaktifkan Nebula Tabungan \u2726',
            typingPhrases: ['Ayo Nabung\u2022', 'Ayo Mulai\u2022', 'Ayo Membeli Barang Yang Kamu Inginkan\u2022', 'Ayo Wujudkan Mimpi\u2022', 'Ayo Bebas Finansial\u2022', 'Ayo Disiplin\u2022'],
            langLabel: 'Bahasa',
            currencyLabel: 'Mata Uang',
            selectCurrency: 'Pilih Mata Uang',
            editGoal: 'Edit Target',
            uploadImage: 'Unggah Gambar',
            login: '\uD83D\uDE80 Masuk',
            register: '\u2728 Daftar',
            guest: 'Lanjut sebagai Tamu',
            registerSubmit: 'Daftar',
            backToLogin: 'Sudah punya akun? Masuk',
            agreeTermsLabel: 'Saya sudah membaca dan setuju dengan Syarat Layanan & Kebijakan Privasi.',
            errAgreeRequired: 'Centang persetujuan Syarat Layanan & Kebijakan Privasi untuk melanjutkan.',
            labelLoginEmail: 'Email',
            labelLoginPass: 'Kata sandi',
            labelRegUsername: 'Nama pengguna',
            labelRegEmail: 'Email',
            labelRegPass: 'Kata sandi',
            labelRegConfirm: 'Konfirmasi kata sandi',
            guestName: 'Tamu',
            errEmailRequired: 'Email wajib diisi.',
            errEmailInvalid: 'Email harus mengandung @ (contoh: nama@email.com).',
            errPassRequired: 'Kata sandi wajib diisi.',
            errUserRequired: 'Nama pengguna wajib diisi.',
            errPassMismatch: 'Kata sandi dan konfirmasi tidak sama.',
            errPassShort: 'Kata sandi minimal 4 karakter.',
            errLoginFailed: 'Email atau kata sandi salah, atau akun belum terdaftar.',
            errEmailTaken: 'Email ini sudah terdaftar. Gunakan Masuk atau email lain.',
            errLoginCooldown: 'Terlalu banyak percobaan. Tunggu {seconds}s.',
            cryptoEncrypting: 'Mengenkripsi...',
            cryptoVerifying: 'Memverifikasi...',
            errCrypto: 'Pustaka enkripsi gagal dimuat. Muat ulang halaman.',
            menuAiHeader: '🧠 AI & Asisten',
            menuAiChat: '💬 Chat AI (Gemini/Grok/HF)',
            menuGoalsHeader: '🎯 Target',
            menuChart: '📊 Grafik Target',
            menuPrediction: '📈 Prediksi Target',
            menuHistory: '📜 Histori Setoran',
            menuExport: '📤 Ekspor Data',
            menuImport: '📥 Impor Data',
            menuSettingHeader: '⚙️ Pengaturan',
            menuSettings: '🛠️ Pengaturan & Tema',
            menuLogout: '🚪 Logout',
            emptyStateMsg: '✨ Belum ada target nabung. Klik tombol + untuk memulai ✨',
            btnDeposit: '💰 Setor',
            btnComplete: '✅ Selesai',
            statusDone: '✔️ Tercapai',
            sidebarDarkMode: 'Mode Gelap',
            loginThemeLabel: 'Mode',
            layoutModeLabel: 'Tata Letak',
            resetAllDataBtn: 'Hapus Semua Data',
            modalSetorTitle: '💰 Setor ke "{name}"',
            setorAmountPlaceholder: 'Nominal (Rp)',
            setorNotePlaceholder: 'Catatan (opsional)',
            setorNowBtn: 'Setor Sekarang',
            cancelBtn: 'Batal',
            invalidAmount: 'Masukkan nominal valid',
            depositSuccess: '✅ Setor Rp {amount} berhasil!',
            targetReachedToast: '🎉 Selamat! Target tercapai!',
            addTargetTitle: '✨ Target Nabung Baru',
            targetNamePlaceholder: 'Nama Nabung (contoh: Liburan)',
            optional: 'opsional',
            targetDescLabel: 'Deskripsi (opsional)',
            targetDescPlaceholder: 'Tulis deskripsimu di sini...',
            targetAmountPlaceholder: 'Target Nominal (Rp)',
            routineAmountPlaceholder: 'Jumlah setoran rutin (opsional)',
            deadlinePlaceholder: 'Tanggal target selesai (opsional)',
            createTargetBtn: 'Mulai Nabung',
            createTargetInvalid: 'Isi nama dan nominal target!',
            createTargetSuccess: '🎯 Target "{name}" dibuat!',
            predictionMessage: '📈 Prediksi: Jika nabung Rp30k/hari, dalam 6 bulan terkumpul Rp5.4jt.',
            noTargetYet: 'Belum ada target.',
            noHistoryYet: 'Belum ada riwayat setoran.',
            historyTitle: '📜 Riwayat:',
            exportSuccess: 'Ekspor berhasil',
            aiTitle: '🤖 Asisten AI - Infinity Saving',
            aiModelLabel: 'Pilih Model AI:',
            aiApiKeyLabel: '🔑 API Key:',
            aiApiKeyPlaceholder: 'Masukkan API Key...',
            aiApiKeyHint: '💡 Dapatkan key:',
            aiPlaceholder: 'Tanya tentang nabung, motivasi, tips...',
            aiInputPlaceholder: 'Tanya tentang nabung, motivasi, tips...',
            aiSendBtn: 'Kirim',
            aiThinking: 'AI sedang mengetik...',
            aiWelcome: '👋 Halo! Saya asisten nabung. Pilih model, masukkan API Key, lalu tanyakan apa pun tentang keuangan dan targetmu!',
            aiNeedApiKey: '⚠️ Silakan masukkan API Key terlebih dahulu.',
            aiNetworkErrorPrefix: '⚠️ Error jaringan:',
            aiUnknownModel: 'Model tidak dikenal.',
            aiRoleUser: 'Anda',
            aiRoleAssistant: 'AI',
            resetDone: 'Reset selesai',
            confirmReset: 'Hapus semua target & transaksi?',
            chartCollectedLabel: 'Terkumpul',
            chartTargetLabel: 'Target',
            scheduleDaily: 'Setiap Hari',
            scheduleMonday: 'Setiap Senin',
            scheduleTuesday: 'Setiap Selasa',
            scheduleWednesday: 'Setiap Rabu',
            scheduleThursday: 'Setiap Kamis',
            scheduleFriday: 'Setiap Jumat',
            scheduleSaturday: 'Setiap Sabtu',
            scheduleSunday: 'Setiap Minggu',
            scheduleWeekdays: 'Senin - Jumat',
            scheduleWeekend: 'Akhir Pekan',
            scheduleFlexible: 'Bebas',
            dayUnit: 'hari',
            legalLinkTos: 'Syarat Layanan',
            legalLinkPrivacy: 'Privasi',
            legalLinkHelp: 'Bantuan',
            legalClose: 'Tutup',
            legalTosTitle: 'Syarat Layanan',
            legalTosHtml: 'Copyright (c) 2026 Zycresth & Fahmi-astronot. Licensed under MIT.<p><strong>Ruang lingkup.</strong> Nabung Infinity adalah aplikasi tabungan <em>local-first</em> yang berjalan di perangkat Anda melalui browser. Tidak ada akun wajib di server kami untuk fitur inti aplikasi.</p><p><strong>Penggunaan yang diperbolehkan.</strong> Gunakan aplikasi untuk mencatat target dan tabungan pribadi. Dilarang memakai aplikasi untuk aktivitas ilegal atau melanggar hukum setempat.</p><p><strong>Tanggung jawab Anda.</strong> Anda bertanggung jawab atas keamanan perangkat, kata sandi, dan membuat cadangan data (misalnya lewat ekspor JSON).</p><p><strong>Perangkat lunak disediakan apa adanya.</strong> Tidak ada jaminan bebas bug, ketersediaan terus-menerus, atau kesesuaian untuk tujuan tertentu.</p><p><strong>Batasan tanggung jawab.</strong> Kami tidak bertanggung jawab atas kehilangan data karena penghapusan cache, reset browser, kerusakan perangkat, atau kelalaian cadangan. Zycresth & Fahmi-astronot tidak bertanggung jawab atas kehilangan data akibat penghapusan local storage/cache.</p><p>Dengan menggunakan aplikasi, Anda menyetujui syarat ini.</p>',
            legalPrivacyTitle: 'Kebijakan Privasi',
            legalPrivacyHtml: '<p><strong>Penyimpanan lokal saja.</strong> Semua data aplikasi disimpan <strong>hanya di localStorage browser</strong> pada perangkat yang Anda gunakan. Ini meliputi akun terdaftar, <strong>kata sandi yang sudah di-hash</strong> (bukan teks asli), target nabung, transaksi, pengaturan, dan data vault per pengguna.</p><p><strong>Tidak dikirim ke server kami.</strong> Data inti aplikasi <strong>tidak dikirim</strong> ke server pengembang atau pihak ketiga oleh aplikasi ini. Tidak ada sinkronisasi cloud bawaan.</p><p><strong>Fitur opsional pihak ketiga.</strong> Jika Anda memakai fitur seperti obrolan AI dan memasukkan kunci API atau teks Anda sendiri, permintaan tersebut dikirim ke penyedia yang Anda pilih sesuai kebijakan mereka—bukan sebagai bagian penyimpanan akun inti aplikasi.</p><p><strong>Kata sandi.</strong> Yang disimpan adalah hash bcrypt di perangkat Anda; kami tidak menerima atau menyimpan kata sandi teks-jelas di infrastruktur kami untuk fitur lokal ini.</p>',
            legalHelpTitle: 'Bantuan & FAQ',
            legalHelpHtml: '<p><strong>Bagaimana data saya disimpan?</strong> Data disimpan otomatis di localStorage saat Anda membuat target, mencatat setoran, mendaftar, atau mengubah pengaturan. Tidak perlu tombol Simpan terpisah untuk sebagian besar aksi.</p><p><strong>Bagaimana enkripsi kata sandi bekerja?</strong> Saat mendaftar, kata sandi di-hash dengan bcrypt di browser Anda sebelum disimpan. Saat masuk, aplikasi membandingkan kata sandi yang Anda ketik dengan hash yang tersimpan. Teks kata sandi asli tidak disimpan di localStorage untuk akun baru.</p><p><strong>Apa jika saya membersihkan cache atau data situs?</strong> Membersihkan data browser, cache, atau penyimpanan untuk situs ini dapat <strong>menghapus seluruh data</strong> di perangkat ini, termasuk akun, target, dan riwayat. <strong>Gunakan menu Ekspor JSON</strong> secara berkala untuk cadangan. Tanpa cadangan, data mungkin tidak dapat dipulihkan.</p><p><strong>Akun lama?</strong> Jika Anda pernah mendaftar sebelum hashing, masuk sekali akan meng-upgrade penyimpanan ke hash jika masih memungkinkan.</p><p><strong>Kredit.</strong> Konsep asli oleh Fahmi-astronot, dikembangkan dan diperkuat oleh Zycresth.</p>',
            predictionTitle: '📈 Prediksi Target Cerdas',
            etaLabel: 'Estimasi',
            statusLabel: 'Status',
            progressLabel: 'Sisa',
            routineLabel: 'Setoran Rutin',
            periodsLabel: 'hari',
            monthsUnit: 'bulan',
            onTrack: 'On Track 🔥',
            monitor: 'Monitor ⚡',
            needAction: 'Need Action ⚠️',
            noPredictionData: 'Belum ada prediksi. Tambahkan setoran rutin ke target Anda.',
            notSet: 'Tidak diatur',
            importSuccess: '✅ Import berhasil!',
            importFailed: '❌ File tidak valid',
            confirmImport: '⚠️ Peringatan: Mengimpor data akan menggantikan semua data saat ini. Lanjutkan?',
            importBtn: '📥 Impor Data',
            exportBtn: '📤 Ekspor Data',
            labelAdvanced: 'Lanjutan',
            btnExportJson: 'Ekspor Data (JSON)',
            btnExportTxt: 'Ekspor Laporan (Txt)',
            btnImportData: 'Impor Data'
        },
        en: {
            appTitle: 'Infinity Saving - Save Your Dreams',
            loadingTagline: '\u2726 Activating Nebula Savings \u2726',
            typingPhrases: ['Save More\u2022', 'Start Now\u2022', 'Buy What You Love\u2022', 'Make Dreams Real\u2022', 'Financial Freedom\u2022', 'Stay Disciplined\u2022'],
            langLabel: 'Language',
            currencyLabel: 'Currency',
            selectCurrency: 'Select Currency',
            editGoal: 'Edit Goal',
            uploadImage: 'Upload Image',
            login: '\uD83D\uDE80 Sign in',
            register: '\u2728 Register',
            guest: 'Continue as guest',
            registerSubmit: 'Register',
            backToLogin: 'Already have an account? Sign in',
            agreeTermsLabel: 'I have read and agree to the Terms of Service & Privacy Policy.',
            errAgreeRequired: 'Please check the agreement to continue.',
            labelLoginEmail: 'Email',
            labelLoginPass: 'Password',
            labelRegUsername: 'Username',
            labelRegEmail: 'Email',
            labelRegPass: 'Password',
            labelRegConfirm: 'Confirm password',
            guestName: 'Guest',
            errEmailRequired: 'Email is required.',
            errEmailInvalid: 'Email must contain @ (e.g. name@email.com).',
            errPassRequired: 'Password is required.',
            errUserRequired: 'Username is required.',
            errPassMismatch: 'Password and confirmation do not match.',
            errPassShort: 'Password must be at least 4 characters.',
            errLoginFailed: 'Wrong email or password, or account is not registered.',
            errEmailTaken: 'This email is already registered. Sign in or use another email.',
            errLoginCooldown: 'Too many attempts. Wait {seconds}s.',
            cryptoEncrypting: 'Encrypting...',
            cryptoVerifying: 'Verifying...',
            errCrypto: 'Encryption library failed to load. Please refresh the page.',
            menuAiHeader: '🧠 AI & Assistant',
            menuAiChat: '💬 AI Chat (Gemini/Grok/HF)',
            menuGoalsHeader: '🎯 Goals',
            menuPrediction: '📈 Goal Prediction',
            menuChart: '📊 Goal Chart',
            menuHistory: '📜 Deposit History',
            menuExport: '📤 Export Data',
            menuImport: '📥 Import Data',
            menuSettingHeader: '⚙️ Settings',
            menuLogout: '🚪 Logout',
            emptyStateMsg: '✨ No savings goals yet. Click + to start ✨',
            btnDeposit: '💰 Deposit',
            btnComplete: '✅ Complete',
            statusDone: '✔️ Achieved',
            sidebarDarkMode: 'Dark Mode',
            loginThemeLabel: 'Mode',
            layoutModeLabel: 'Layout',
            resetAllDataBtn: 'Delete All Data',
            modalSetorTitle: '💰 Deposit to "{name}"',
            setorAmountPlaceholder: 'Amount (Rp)',
            setorNotePlaceholder: 'Note (optional)',
            setorNowBtn: 'Deposit Now',
            cancelBtn: 'Cancel',
            invalidAmount: 'Enter a valid amount',
            depositSuccess: '✅ Deposit Rp {amount} successful!',
            targetReachedToast: '🎉 Congrats! Target achieved!',
            addTargetTitle: '✨ New Savings Goal',
            targetNamePlaceholder: 'Goal name (e.g. Vacation)',
            optional: 'optional',
            targetDescLabel: 'Description (optional)',
            targetDescPlaceholder: 'Write your description...',
            targetAmountPlaceholder: 'Target Amount (Rp)',
            routineAmountPlaceholder: 'Routine deposit amount (optional)',
            deadlinePlaceholder: 'Target deadline date (optional)',
            createTargetBtn: 'Start Saving',
            createTargetInvalid: 'Fill in a goal name and amount!',
            createTargetSuccess: '🎯 Goal "{name}" created!',
            predictionMessage: '📈 Prediction: Saving Rp30k/day reaches Rp5.4M in 6 months.',
            noTargetYet: 'No goals yet.',
            noHistoryYet: 'No deposit history yet.',
            historyTitle: '📜 History:',
            exportSuccess: 'Export successful',
            aiTitle: '🤖 AI Assistant - Infinity Saving',
            aiModelLabel: 'Select AI Model:',
            aiApiKeyLabel: '🔑 API Key:',
            aiApiKeyPlaceholder: 'Enter API Key...',
            aiApiKeyHint: '💡 Get keys:',
            aiPlaceholder: 'Ask about saving, motivation, tips...',
            aiInputPlaceholder: 'Ask about saving, motivation, tips...',
            aiSendBtn: 'Send',
            aiThinking: 'AI is thinking...',
            aiWelcome: '👋 Hi! I am your saving assistant. Choose a model, enter your API key, and ask anything about finance and goals!',
            aiNeedApiKey: '⚠️ Please enter an API Key first.',
            aiNetworkErrorPrefix: '⚠️ Network error:',
            aiUnknownModel: 'Unknown model.',
            aiRoleUser: 'You',
            aiRoleAssistant: 'AI',
            resetDone: 'Reset complete',
            confirmReset: 'Delete all goals & transactions?',
            chartCollectedLabel: 'Collected',
            chartTargetLabel: 'Target',
            scheduleDaily: 'Every Day',
            scheduleMonday: 'Every Monday',
            scheduleTuesday: 'Every Tuesday',
            scheduleWednesday: 'Every Wednesday',
            scheduleThursday: 'Every Thursday',
            scheduleFriday: 'Every Friday',
            scheduleSaturday: 'Every Saturday',
            scheduleSunday: 'Every Sunday',
            scheduleWeekdays: 'Monday - Friday',
            scheduleWeekend: 'Weekend',
            scheduleFlexible: 'Flexible',
            dayUnit: 'days',
            legalLinkTos: 'Terms of Service',
            legalLinkPrivacy: 'Privacy Policy',
            legalLinkHelp: 'Help',
            legalClose: 'Close',
            legalTosTitle: 'Terms of Service',
            legalTosHtml: 'Copyright (c) 2026 Zycresth & Fahmi-astronot. Licensed under MIT.<p><strong>Scope.</strong> Nabung Infinity is a <em>local-first</em> savings app that runs in your browser on your device. Core features do not require an account on our servers.</p><p><strong>Permitted use.</strong> Use the app to track personal savings goals. Do not use it for illegal activity or to violate applicable laws.</p><p><strong>Your responsibility.</strong> You are responsible for device security, passwords, and backing up your data (for example via JSON export).</p><p><strong>Software as-is.</strong> There is no warranty of uninterrupted service, fitness for a particular purpose, or freedom from errors.</p><p><strong>Limitation of liability.</strong> We are not liable for data loss caused by clearing cache, browser resets, device failure, or failure to keep backups. Zycresth & Fahmi-astronot are not liable for any data loss due to local storage/cache clearing.</p><p>By using the app, you agree to these terms.</p>',
            legalPrivacyTitle: 'Privacy Policy',
            legalPrivacyHtml: '<p><strong>Local storage only.</strong> All app data is stored <strong>only in your browser localStorage</strong> on this device. This includes registered accounts, <strong>hashed passwords</strong> (not plain text), savings targets, transactions, settings, and per-user vault data.</p><p><strong>Not sent to our servers.</strong> Core app data is <strong>not transmitted</strong> to the developer’s servers or third parties by this app. There is no built-in cloud sync.</p><p><strong>Optional third-party features.</strong> If you use features such as AI chat and enter an API key or your own messages, those requests are sent to the provider you choose under their policies—not as part of the app’s core local account storage.</p><p><strong>Passwords.</strong> What is stored is a bcrypt hash on your device; we do not receive or store plain-text passwords on our infrastructure for this local-first flow.</p>',
            legalHelpTitle: 'Help & FAQ',
            legalHelpHtml: '<p><strong>How is my data saved?</strong> Data is saved automatically to localStorage when you create targets, log deposits, register, or change settings. Most actions do not need a separate Save button.</p><p><strong>How does password protection work?</strong> On sign-up, your password is hashed with bcrypt in your browser before storage. On sign-in, the app compares what you type to the stored hash. Plain passwords are not stored in localStorage for new accounts.</p><p><strong>What if I clear cache or site data?</strong> Clearing browser data, cache, or storage for this site can <strong>erase all data</strong> on this device, including accounts, targets, and history. <strong>Use Export JSON</strong> in the menu regularly for backups. Without a backup, data may be unrecoverable.</p><p><strong>Older accounts?</strong> If you registered before hashing was added, signing in once may upgrade storage to a hash when applicable.</p><p><strong>Credits.</strong> Original concept by Fahmi-astronot, developed and hardened by Zycresth.</p>',
            predictionTitle: '📈 Smart Goal Prediction',
            etaLabel: 'Estimate',
            statusLabel: 'Status',
            progressLabel: 'Remaining',
            routineLabel: 'Routine Deposit',
            periodsLabel: 'days',
            monthsUnit: 'months',
            onTrack: 'On Track 🔥',
            monitor: 'Monitor ⚡',
            needAction: 'Need Action ⚠️',
            noPredictionData: 'No predictions yet. Add routine deposits to your goals.',
            notSet: 'Not set',
            importSuccess: '✅ Import successful!',
            importFailed: '❌ Invalid file',
            confirmImport: '⚠️ Warning: Importing data will replace all current data. Continue?',
            importBtn: '📥 Import Data',
            exportBtn: '📤 Export Data',
            labelAdvanced: 'Advanced',
            btnExportJson: 'Export Data (JSON)',
            btnExportTxt: 'Export Report (Txt)',
            btnImportData: 'Import Data'
        },
        ms: {
            appTitle: 'Infinity Saving - Simpan Impian Anda',
            loadingTagline: '\u2726 Mengaktifkan Simpanan Nebula \u2726',
            typingPhrases: ['Jom Simpan\u2022', 'Mula Sekarang\u2022', 'Beli Barang Idaman\u2022', 'Wujudkan Impian\u2022', 'Bebas Kewangan\u2022', 'Berdisiplin\u2022'],
            langLabel: 'Bahasa',
            currencyLabel: 'Mata Wang',
            selectCurrency: 'Pilih Mata Wang',
            editGoal: 'Sunting Sasaran',
            uploadImage: 'Muat Naik Gambar',
            login: '\uD83D\uDE80 Log masuk',
            register: '\u2728 Daftar',
            guest: 'Teruskan sebagai tetamu',
            registerSubmit: 'Daftar',
            backToLogin: 'Sudah ada akaun? Log masuk',
            agreeTermsLabel: 'Saya telah membaca dan bersetuju dengan Terma Perkhidmatan & Dasar Privasi.',
            errAgreeRequired: 'Sila tandakan persetujuan untuk meneruskan.',
            labelLoginEmail: 'E-mel',
            labelLoginPass: 'Kata laluan',
            labelRegUsername: 'Nama pengguna',
            labelRegEmail: 'E-mel',
            labelRegPass: 'Kata laluan',
            labelRegConfirm: 'Sahkan kata laluan',
            guestName: 'Tetamu',
            errEmailRequired: 'E-mel diperlukan.',
            errEmailInvalid: 'E-mel mesti mengandungi @ (cth. nama@email.com).',
            errPassRequired: 'Kata laluan diperlukan.',
            errUserRequired: 'Nama pengguna diperlukan.',
            errPassMismatch: 'Kata laluan dan pengesahan tidak sepadan.',
            errPassShort: 'Kata laluan sekurang-kurangnya 4 aksara.',
            errLoginFailed: 'E-mel atau kata laluan salah, atau akaun tidak didaftarkan.',
            errEmailTaken: 'E-mel ini sudah didaftarkan. Log masuk atau guna e-mel lain.',
            errLoginCooldown: 'Terlalu banyak percubaan. Tunggu {seconds}s.',
            cryptoEncrypting: 'Menyulitkan...',
            cryptoVerifying: 'Mengesahkan...',
            errCrypto: 'Pustaka penyulitan gagal dimuat. Segar semula halaman.',
            menuAiHeader: '🧠 AI & Pembantu',
            menuAiChat: '💬 Sembang AI (Gemini/Grok/HF)',
            menuGoalsHeader: '🎯 Sasaran',
            menuPrediction: '📈 Ramalan Sasaran',
            menuChart: '📊 Carta Sasaran',
            menuHistory: '📜 Sejarah Deposit',
            menuExport: '📤 Export Data',
            menuImport: '📥 Import Data',
            menuSettingHeader: '⚙️ Tetapan',
            menuLogout: '🚪 Log keluar',
            emptyStateMsg: '✨ Belum ada sasaran simpanan. Klik + untuk mula ✨',
            btnDeposit: '💰 Deposit',
            btnComplete: '✅ Selesai',
            statusDone: '✔️ Tercapai',
            sidebarDarkMode: 'Mod Gelap',
            loginThemeLabel: 'Mod',
            layoutModeLabel: 'Susun Atur',
            resetAllDataBtn: 'Padam Semua Data',
            modalSetorTitle: '💰 Deposit ke "{name}"',
            setorAmountPlaceholder: 'Jumlah (Rp)',
            setorNotePlaceholder: 'Nota (pilihan)',
            setorNowBtn: 'Deposit Sekarang',
            cancelBtn: 'Batal',
            invalidAmount: 'Masukkan jumlah yang sah',
            depositSuccess: '✅ Deposit Rp {amount} berjaya!',
            targetReachedToast: '🎉 Tahniah! Sasaran tercapai!',
            addTargetTitle: '✨ Sasaran Simpanan Baru',
            targetNamePlaceholder: 'Nama sasaran (cth: Percutian)',
            optional: 'pilihan',
            targetDescLabel: 'Penerangan (pilihan)',
            targetDescPlaceholder: 'Tulis penerangan anda...',
            targetAmountPlaceholder: 'Jumlah Sasaran (Rp)',
            routineAmountPlaceholder: 'Jumlah deposit rutin (pilihan)',
            deadlinePlaceholder: 'Tarikh sasaran tamat (pilihan)',
            createTargetBtn: 'Mula Menyimpan',
            createTargetInvalid: 'Isi nama sasaran dan jumlah!',
            createTargetSuccess: '🎯 Sasaran "{name}" dicipta!',
            predictionMessage: '📈 Ramalan: Simpan Rp30k/hari capai Rp5.4j dalam 6 bulan.',
            noTargetYet: 'Belum ada sasaran.',
            noHistoryYet: 'Belum ada sejarah deposit.',
            historyTitle: '📜 Sejarah:',
            exportSuccess: 'Eksport berjaya',
            aiTitle: '🤖 Pembantu AI - Infinity Saving',
            aiModelLabel: 'Pilih Model AI:',
            aiApiKeyLabel: '🔑 API Key:',
            aiApiKeyPlaceholder: 'Masukkan API Key...',
            aiApiKeyHint: '💡 Dapatkan key:',
            aiPlaceholder: 'Tanya tentang simpanan, motivasi, tip...',
            aiInputPlaceholder: 'Tanya tentang simpanan, motivasi, tip...',
            aiSendBtn: 'Hantar',
            aiThinking: 'AI sedang menaip...',
            aiWelcome: '👋 Hai! Saya pembantu simpanan anda. Pilih model, masukkan API Key, dan tanya apa sahaja tentang kewangan serta sasaran!',
            aiNeedApiKey: '⚠️ Sila masukkan API Key terlebih dahulu.',
            aiNetworkErrorPrefix: '⚠️ Ralat rangkaian:',
            aiUnknownModel: 'Model tidak dikenali.',
            aiRoleUser: 'Anda',
            aiRoleAssistant: 'AI',
            resetDone: 'Tetapan semula selesai',
            confirmReset: 'Padam semua sasaran & transaksi?',
            chartCollectedLabel: 'Terkumpul',
            chartTargetLabel: 'Sasaran',
            scheduleDaily: 'Setiap Hari',
            scheduleMonday: 'Setiap Isnin',
            scheduleTuesday: 'Setiap Selasa',
            scheduleWednesday: 'Setiap Rabu',
            scheduleThursday: 'Setiap Khamis',
            scheduleFriday: 'Setiap Jumaat',
            scheduleSaturday: 'Setiap Sabtu',
            scheduleSunday: 'Setiap Ahad',
            scheduleWeekdays: 'Isnin - Jumaat',
            scheduleWeekend: 'Hujung Minggu',
            scheduleFlexible: 'Fleksibel',
            dayUnit: 'hari',
            legalLinkTos: 'Terma Perkhidmatan',
            legalLinkPrivacy: 'Dasar Privasi',
            legalLinkHelp: 'Bantuan',
            legalClose: 'Tutup',
            legalTosTitle: 'Terma Perkhidmatan',
            legalTosHtml: 'Copyright (c) 2026 Zycresth & Fahmi-astronot. Licensed under MIT.<p><strong>Skop.</strong> Nabung Infinity ialah aplikasi simpanan <em>local-first</em> yang berfungsi dalam pelayar pada peranti anda. Ciri teras tidak memerlukan akaun di pelayan kami.</p><p><strong>Penggunaan dibenarkan.</strong> Gunakan aplikasi untuk merekod sasaran dan simpanan peribadi. Dilarang menggunakan aplikasi untuk aktiviti haram atau melanggar undang-undang tempatan.</p><p><strong>Tanggungjawab anda.</strong> Anda bertanggungjawab terhadap keselamatan peranti, kata laluan, dan sandaran data (contohnya eksport JSON).</p><p><strong>Perisian diberikan apa adanya.</strong> Tiada jaminan perkhidmatan tanpa gangguan, kesesuaian untuk tujuan tertentu, atau bebas ralat.</p><p><strong>Had liabiliti.</strong> Kami tidak bertanggungjawab ke atas kehilangan data akibat pengosongan cache, tetapan semula pelayar, kerosakan peranti, atau kegagalan menyandarkan data. Zycresth & Fahmi-astronot tidak bertanggungjawab atas sebarang kehilangan data akibat pengosongan local storage/cache.</p><p>Dengan menggunakan aplikasi, anda bersetuju dengan terma ini.</p>',
            legalPrivacyTitle: 'Dasar Privasi',
            legalPrivacyHtml: '<p><strong>Penyimpanan tempatan sahaja.</strong> Semua data aplikasi disimpan <strong>hanya dalam localStorage pelayar</strong> pada peranti ini. Ini termasuk akaun berdaftar, <strong>kata laluan yang di-hash</strong> (bukan teks jelas), sasaran simpanan, transaksi, tetapan, dan data vault mengikut pengguna.</p><p><strong>Tidak dihantar ke pelayan kami.</strong> Data teras aplikasi <strong>tidak dihantar</strong> ke pelayan pembangun atau pihak ketiga oleh aplikasi ini. Tiada penyegerakan awan terbina dalam.</p><p><strong>Ciri pihak ketiga pilihan.</strong> Jika anda menggunakan ciri seperti sembang AI dan memasukkan kunci API atau teks anda sendiri, permintaan tersebut dihantar ke penyedia yang anda pilih mengikut dasar mereka—bukan sebagai sebahagian penyimpanan akaun teras tempatan.</p><p><strong>Kata laluan.</strong> Yang disimpan ialah hash bcrypt pada peranti anda; kami tidak menerima atau menyimpan kata laluan teks jelas dalam infrastruktur kami untuk aliran tempatan ini.</p>',
            legalHelpTitle: 'Bantuan & Soalan Lazim',
            legalHelpHtml: '<p><strong>Bagaimana data saya disimpan?</strong> Data disimpan secara automatik ke localStorage apabila anda mencipta sasaran, merekod deposit, mendaftar, atau menukar tetapan. Kebanyakan tindakan tidak memerlukan butang Simpan berasingan.</p><p><strong>Bagaimana perlindungan kata laluan berfungsi?</strong> Semasa pendaftaran, kata laluan di-hash dengan bcrypt dalam pelayar anda sebelum disimpan. Semasa log masuk, aplikasi membandingkan input anda dengan hash yang disimpan. Kata laluan teks jelas tidak disimpan dalam localStorage untuk akaun baharu.</p><p><strong>Apa jika saya mengosongkan cache atau data laman?</strong> Mengosongkan data pelayar, cache, atau storan untuk laman ini boleh <strong>memadam semua data</strong> pada peranti ini, termasuk akaun, sasaran, dan sejarah. <strong>Gunakan Eksport JSON</strong> dalam menu secara berkala untuk sandaran. Tanpa sandaran, data mungkin tidak dapat dipulihkan.</p><p><strong>Akaun lama?</strong> Jika anda mendaftar sebelum hashing ditambah, log masuk sekali mungkin menaik taraf storan kepada hash jika berkenaan.</p><p><strong>Kredit.</strong> Konsep asal oleh Fahmi-astronot, dibangunkan dan diperkukuh oleh Zycresth.</p>',
            predictionTitle: '📈 Ramalan Sasaran Pintar',
            etaLabel: 'Anggaran',
            statusLabel: 'Status',
            progressLabel: 'Baki',
            routineLabel: 'Deposit Rutin',
            periodsLabel: 'hari',
            monthsUnit: 'bulan',
            onTrack: 'On Track 🔥',
            monitor: 'Monitor ⚡',
            needAction: 'Need Action ⚠️',
            noPredictionData: 'Belum ada ramalan. Tambah deposit rutin pada sasaran anda.',
            notSet: 'Tidak ditetapkan',
            importSuccess: '✅ Import berjaya!',
            importFailed: '❌ Fail tidak sah',
            confirmImport: '⚠️ Amaran: Mengimport data akan menggantikan semua data semasa. Teruskan?',
            importBtn: '📥 Import Data',
            exportBtn: '📤 Export Data',
            labelAdvanced: 'Lanjutan',
            btnExportJson: 'Eksport Data (JSON)',
            btnExportTxt: 'Eksport Laporan (Txt)',
            btnImportData: 'Import Data'
        }
    };

    let currentLang = localStorage.getItem('nabung_lang') || 'en';
    if (!I18N[currentLang]) currentLang = 'en';
    let phrases = I18N[currentLang].typingPhrases.slice();
    let idx = 0, charIdx = 0, isDeleting = false;
    let typingTimer = null;
    let loginFailCount = 0;
    let loginLockUntil = 0;
    let loginLockTimer = null;

    function stopTyping() {
        if (typingTimer) {
            clearTimeout(typingTimer);
            typingTimer = null;
        }
    }

    function restartTyping() {
        stopTyping();
        idx = 0; charIdx = 0; isDeleting = false;
        const el = document.getElementById('typingText');
        if (el) el.innerText = '';
        typeEffect();
    }

    function typeEffect() {
        const el = document.getElementById('typingText');
        if (!el) return;
        const current = phrases[idx];
        if (!isDeleting && charIdx <= current.length) {
            el.innerText = current.substring(0, charIdx);
            charIdx++;
            if (charIdx > current.length) {
                isDeleting = true;
                typingTimer = setTimeout(typeEffect, 1000);
                return;
            }
        } else if (isDeleting && charIdx >= 0) {
            el.innerText = current.substring(0, charIdx);
            charIdx--;
            if (charIdx < 0) {
                isDeleting = false;
                idx = (idx + 1) % phrases.length;
                charIdx = 0;
            }
        }
        typingTimer = setTimeout(typeEffect, isDeleting ? 50 : 100);
    }

    function t(key) {
        const b = I18N[currentLang] || I18N.id;
        if (b[key] !== undefined) return b[key];
        return I18N.id[key] !== undefined ? I18N.id[key] : key;
    }
    function tWithParams(key, params) {
        let text = t(key);
        if (!params || typeof text !== 'string') return text;
        Object.keys(params).forEach(function (k) {
            text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), String(params[k]));
        });
        return text;
    }
    function getLoginLockRemainingSec() {
        return Math.max(0, Math.ceil((loginLockUntil - Date.now()) / 1000));
    }
    function stopLoginCooldownTicker() {
        if (loginLockTimer) {
            clearInterval(loginLockTimer);
            loginLockTimer = null;
        }
    }
    function updateLoginCooldownUI() {
        const seconds = getLoginLockRemainingSec();
        const btn = document.getElementById('btnLogin');
        if (seconds > 0) {
            if (btn) btn.disabled = true;
            setAuthError('loginError', tWithParams('errLoginCooldown', { seconds: seconds }));
            return;
        }
        stopLoginCooldownTicker();
        if (btn) btn.disabled = false;
    }
    function startLoginCooldown(seconds) {
        loginLockUntil = Date.now() + (seconds * 1000);
        updateLoginCooldownUI();
        stopLoginCooldownTicker();
        loginLockTimer = setInterval(updateLoginCooldownUI, 1000);
    }

    function applyLanguage(lang) {
        if (lang && I18N[lang]) currentLang = lang;
        localStorage.setItem('nabung_lang', currentLang);
        document.documentElement.lang = currentLang === 'en' ? 'en' : currentLang === 'ms' ? 'ms' : 'id';
        document.title = t('appTitle');
        phrases = (I18N[currentLang] || I18N.id).typingPhrases.slice();

        const tag = document.getElementById('loadingTagline');
        if (tag) tag.textContent = t('loadingTagline');

        const loginBtn = document.getElementById('btnLogin');
        if (loginBtn) loginBtn.textContent = t('login');
        const regBtn = document.getElementById('btnShowRegister');
        if (regBtn) regBtn.textContent = t('register');
        const guestBtn = document.getElementById('btnGuest');
        if (guestBtn) guestBtn.textContent = t('guest');

        const langLbl = document.getElementById('langLabel');
        if(langLbl) langLbl.textContent = t('langLabel');
        const langSel = document.getElementById('langSelect');
        if(langSel) langSel.value = currentLang;
        const loginThemeLabel = document.getElementById('loginThemeLabel');
        if(loginThemeLabel) loginThemeLabel.textContent = t('loginThemeLabel');
        const loginThemeSelect = document.getElementById('loginThemeSelect');
        if(loginThemeSelect) loginThemeSelect.value = settings.theme || 'dark';
        const sidebarLangSel = document.getElementById('sidebarLangSelect');
        if (sidebarLangSel) sidebarLangSel.value = currentLang;
        const sidebarLangLbl = document.getElementById('sidebarLangLabel');
        if (sidebarLangLbl) sidebarLangLbl.textContent = t('langLabel');
        const sidebarCurrencyLbl = document.getElementById('sidebarCurrencyLabel');
        if (sidebarCurrencyLbl) sidebarCurrencyLbl.textContent = t('currencyLabel');
        const sidebarDarkLbl = document.getElementById('sidebarDarkModeLabel');
        if (sidebarDarkLbl) sidebarDarkLbl.textContent = t('sidebarDarkMode');
        const sidebarDarkToggle = document.getElementById('sidebarDarkModeToggle');
        if (sidebarDarkToggle) sidebarDarkToggle.value = settings.theme || 'dark';
        
        // Side rail settings elements
        const sideRailCurrencyLbl = document.getElementById('sideRailCurrencyLabel');
        if (sideRailCurrencyLbl) sideRailCurrencyLbl.textContent = t('currencyLabel');
        const sideRailLangLbl = document.getElementById('sideRailLangLabel');
        if (sideRailLangLbl) sideRailLangLbl.textContent = t('langLabel');
        const sideRailDarkLbl = document.getElementById('sideRailDarkModeLabel');
        if (sideRailDarkLbl) sideRailDarkLbl.textContent = t('sidebarDarkMode');
        const sideRailDarkToggle = document.getElementById('sideRailDarkModeToggle');
        if (sideRailDarkToggle) sideRailDarkToggle.value = settings.theme || 'dark';
        const layoutModeLabel = document.getElementById('layoutModeLabel');
        if (layoutModeLabel) layoutModeLabel.textContent = t('layoutModeLabel');
        const layoutModeToggle = document.getElementById('layoutModeToggle');
        if (layoutModeToggle) layoutModeToggle.value = settings.layoutMode || 'grid';
        const sideRailAdvancedLbl = document.getElementById('sideRailAdvancedLabel');
        if (sideRailAdvancedLbl) sideRailAdvancedLbl.textContent = t('labelAdvanced');
        const sideRailExportJsonBtn = document.getElementById('sideRailExportJsonBtn');
        if (sideRailExportJsonBtn) sideRailExportJsonBtn.textContent = '💾 ' + t('btnExportJson');
        const sideRailExportTxtBtn = document.getElementById('sideRailExportTxtBtn');
        if (sideRailExportTxtBtn) sideRailExportTxtBtn.textContent = '📝 ' + t('btnExportTxt');
        const sideRailImportDataBtn = document.getElementById('sideRailImportDataBtn');
        if (sideRailImportDataBtn) sideRailImportDataBtn.textContent = '📥 ' + t('btnImportData');
        const sideRailResetAllDataBtn = document.getElementById('sideRailResetAllDataBtn');
        if (sideRailResetAllDataBtn) sideRailResetAllDataBtn.textContent = t('resetAllDataBtn');
        const sideRailCurrencySel = document.getElementById('sideRailCurrencySelect');
        if (sideRailCurrencySel) sideRailCurrencySel.value = settings.currency;
        const sideRailLangSel = document.getElementById('sideRailLangSelect');
        if (sideRailLangSel) sideRailLangSel.value = currentLang;
        
        // Export/Import buttons in Settings
        const sidebarAdvancedLabel = document.getElementById('sidebarAdvancedLabel');
        if (sidebarAdvancedLabel) sidebarAdvancedLabel.textContent = t('labelAdvanced');
        const exportJsonBtn = document.getElementById('exportJsonBtn');
        if (exportJsonBtn) exportJsonBtn.textContent = '💾 ' + t('btnExportJson');
        const exportTxtBtn = document.getElementById('exportTxtBtn');
        if (exportTxtBtn) exportTxtBtn.textContent = '📝 ' + t('btnExportTxt');
        const importDataBtn = document.getElementById('importDataBtn');
        if (importDataBtn) importDataBtn.textContent = '📥 ' + t('btnImportData');
        
        const resetBtn = document.getElementById('resetAllDataBtn');
        if (resetBtn) resetBtn.textContent = t('resetAllDataBtn');

        const lblLE = document.getElementById('labelLoginEmail');
        if (lblLE) lblLE.textContent = t('labelLoginEmail');
        const lblLP = document.getElementById('labelLoginPass');
        if (lblLP) lblLP.textContent = t('labelLoginPass');
        const lblRU = document.getElementById('labelRegUsername');
        if (lblRU) lblRU.textContent = t('labelRegUsername');
        const lblRE = document.getElementById('labelRegEmail');
        if (lblRE) lblRE.textContent = t('labelRegEmail');
        const lblRP = document.getElementById('labelRegPass');
        if (lblRP) lblRP.textContent = t('labelRegPass');
        const lblRC = document.getElementById('labelRegConfirm');
        if (lblRC) lblRC.textContent = t('labelRegConfirm');
        const rSub = document.getElementById('btnRegisterSubmit');
        if (rSub) rSub.textContent = t('registerSubmit');
        const backLogin = document.getElementById('btnBackToLogin');
        if (backLogin) backLogin.textContent = t('backToLogin');
        const agreeLbl = document.getElementById('labelAgreeTerms');
        if (agreeLbl) agreeLbl.textContent = t('agreeTermsLabel');

        const lkTos = document.getElementById('linkLegalTos');
        if (lkTos) lkTos.textContent = t('legalLinkTos');
        const lkPriv = document.getElementById('linkLegalPrivacy');
        if (lkPriv) lkPriv.textContent = t('legalLinkPrivacy');
        const lkHelp = document.getElementById('linkLegalHelp');
        if (lkHelp) lkHelp.textContent = t('legalLinkHelp');
        const menuAiHeader = document.getElementById('menuAiHeader');
        if (menuAiHeader) menuAiHeader.textContent = t('menuAiHeader');
        const aiChatBtn = document.getElementById('aiChatBtn');
        if (aiChatBtn) aiChatBtn.textContent = t('menuAiChat');
        const menuGoalsHeader = document.getElementById('menuGoalsHeader');
        if (menuGoalsHeader) menuGoalsHeader.textContent = t('menuGoalsHeader');
        const showChartBtn = document.getElementById('showChartBtn');
        if (showChartBtn) showChartBtn.textContent = t('menuChart');
        const prediksiBtn = document.getElementById('prediksiBtn');
        if (prediksiBtn) prediksiBtn.textContent = t('menuPrediction');
        const historyBtn = document.getElementById('historyBtn');
        if (historyBtn) historyBtn.textContent = t('menuHistory');
        const menuSettingHeader = document.getElementById('menuSettingHeader');
        if (menuSettingHeader) menuSettingHeader.textContent = t('menuSettingHeader');
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) logoutBtn.textContent = t('menuLogout');
        const emptyStateMsg = document.getElementById('emptyStateMsg');
        if (emptyStateMsg) emptyStateMsg.textContent = t('emptyStateMsg');
        const aiInput = document.getElementById('aiInput');
        if (aiInput) aiInput.placeholder = t('aiPlaceholder');
        const sendChatBtn = document.getElementById('sendChatBtn');
        if (sendChatBtn) sendChatBtn.textContent = t('aiSendBtn');
        const typingIndicator = document.getElementById('typingIndicator');
        if (typingIndicator) typingIndicator.textContent = t('aiThinking');
        const aiModelLabel = document.getElementById('aiModelLabel');
        if (aiModelLabel) aiModelLabel.textContent = t('aiModelLabel');
        const aiApiKeyLabel = document.getElementById('aiApiKeyLabel');
        if (aiApiKeyLabel) aiApiKeyLabel.textContent = t('aiApiKeyLabel');
        const aiApiKeyInput = document.getElementById('apiKeyInput');
        if (aiApiKeyInput) aiApiKeyInput.placeholder = t('aiApiKeyPlaceholder');
        const aiTitle = document.getElementById('aiChatTitle');
        if (aiTitle) aiTitle.textContent = t('aiTitle');
        const aiKeyHint = document.getElementById('aiKeyHint');
        if (aiKeyHint) aiKeyHint.textContent = t('aiApiKeyHint');
        const setorAmount = document.getElementById('setorAmount');
        if (setorAmount) setorAmount.placeholder = t('setorAmountPlaceholder');
        const setorNote = document.getElementById('setorNote');
        if (setorNote) setorNote.placeholder = t('setorNotePlaceholder');
        const confirmSetor = document.getElementById('confirmSetor');
        if (confirmSetor) confirmSetor.textContent = t('setorNowBtn');
        const closeModalBtn = document.getElementById('closeModalBtn');
        if (closeModalBtn && closeModalBtn.classList.contains('btn-outline')) closeModalBtn.textContent = t('cancelBtn');

        const auth = document.getElementById('auth-container');
        if (auth && auth.style.display === 'flex') restartTyping();

        const busyOv = document.getElementById('authBusyOverlay');
        if (busyOv && busyOv.dataset.messageKey) {
            const btxt = document.getElementById('authBusyText');
            if (btxt) btxt.textContent = t(busyOv.dataset.messageKey);
        }
        if (document.getElementById('main-app')?.style.display === 'block') {
            // Debounce renderMainUI for performance
            if (langChangeTimeout) clearTimeout(langChangeTimeout);
            langChangeTimeout = setTimeout(() => renderMainUI(), 100);
        }
        updateLoginCooldownUI();
    }

    function setAuthBusy(active, messageKey) {
        const overlay = document.getElementById('authBusyOverlay');
        const textEl = document.getElementById('authBusyText');
        document.querySelectorAll('.login-card input, .login-card button, .login-card select').forEach(function (el) {
            if (overlay && el.closest && el.closest('#authBusyOverlay')) return;
            el.disabled = !!active;
        });
        if (overlay) {
            if (active) {
                overlay.dataset.messageKey = messageKey || '';
                overlay.classList.add('visible');
                overlay.setAttribute('aria-hidden', 'false');
                if (textEl) textEl.textContent = messageKey ? t(messageKey) : '';
            } else {
                overlay.classList.remove('visible');
                delete overlay.dataset.messageKey;
                overlay.setAttribute('aria-hidden', 'true');
                if (textEl) textEl.textContent = '';
            }
        }
        if (!active) updateRegisterSubmitEnabled();
    }

    function setAuthError(elId, message) {
        const el = document.getElementById(elId);
        if (el) el.textContent = message || '';
    }

    function updateRegisterSubmitEnabled() {
        const cb = document.getElementById('agreeTerms');
        const btn = document.getElementById('btnRegisterSubmit');
        if (!btn) return;
        if (!cb) { btn.disabled = false; return; }
        btn.disabled = !cb.checked;
    }

    async function handleLogin() {
        if (currentUser) {
            setLoggedIn(currentUser);
            return;
        }
        if (getLoginLockRemainingSec() > 0) {
            updateLoginCooldownUI();
            return;
        }
        const emailInput = document.getElementById('loginEmail');
        const passInput = document.getElementById('loginPass');
        const email = emailInput ? sanitizeEmailInput(emailInput.value) : '';
        const pass = passInput ? passInput.value : '';

        setAuthError('loginError', '');

        if (!email) {
            setAuthError('loginError', t('errEmailRequired'));
            return;
        }
        if (!emailHasAtValid(email)) {
            setAuthError('loginError', t('errEmailInvalid'));
            return;
        }
        if (!pass) {
            setAuthError('loginError', t('errPassRequired'));
            return;
        }

        const accounts = loadAccounts();
        const match = accounts.find(function (a) {
            return String(a.email).trim().toLowerCase() === email.toLowerCase();
        });
        if (!match) {
            setAuthError('loginError', t('errLoginFailed'));
            loginFailCount += 1;
            if (loginFailCount >= 5) startLoginCooldown(30);
            return;
        }

        setAuthBusy(true, 'cryptoVerifying');
        try {
            if (!ensureBcryptLoaded()) {
                setAuthError('loginError', t('errCrypto'));
                return;
            }
            const ok = await verifyStoredPasswordAsync(pass, match.password);
            if (!ok) {
                setAuthError('loginError', t('errLoginFailed'));
                loginFailCount += 1;
                if (loginFailCount >= 5) startLoginCooldown(30);
                return;
            }
            loginFailCount = 0;
            loginLockUntil = 0;
            stopLoginCooldownTicker();
            if (!isBcryptHash(match.password)) {
                match.password = await bcryptHashAsync(pass);
                saveAccounts(accounts);
            }
            setLoggedIn({ name: match.username, email: match.email.trim(), isGuest: false });
        } catch (e) {
            setAuthError('loginError', t('errCrypto'));
        } finally {
            setAuthBusy(false);
        }
    }

    function loadData() {
        const storedUser = localStorage.getItem('nabung_user');
        if (storedUser) {
            try { currentUser = JSON.parse(storedUser); } catch (e) { currentUser = null; }
        }
        else currentUser = null;

        if (currentUser) loadVaultIntoMemory();
        else {
            targets = [];
            transactions = [];
        }

        const storedSettings = localStorage.getItem('nabung_settings');
        if(storedSettings) {
            try {
                const parsed = JSON.parse(storedSettings);
                if (parsed && typeof parsed === 'object') {
                    settings = Object.assign({ theme: 'dark', currency: 'IDR' }, parsed);
                    // Migrate old boolean darkMode to string theme
                    if (parsed.darkMode !== undefined && parsed.theme === undefined) {
                        settings.theme = parsed.darkMode ? 'dark' : 'light';
                    }
                }
            } catch (e) {}
        }
        applyTheme();
    }
    function saveTargets() {
        syncVaultFromMemory();
    }
    function saveTransactions() {
        syncVaultFromMemory();
    }
    
    // Debounced save function for performance optimization
    function saveData() {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
        }
        
        saveTimeout = setTimeout(() => {
            try {
                const dataToSave = {
                    targets: targets,
                    transactions: transactions,
                    settings: settings
                };
                localStorage.setItem('nabung_app_state', JSON.stringify(dataToSave));
            } catch (e) {
                console.error("Save failed:", e);
            }
        }, DEBOUNCE_DELAY);
    }
    
    // Batch localStorage writes to reduce I/O operations
    function batchLocalStorageWrites(updates) {
        if (!updates || Object.keys(updates).length === 0) return;
        try {
            Object.keys(updates).forEach(key => {
                localStorage.setItem(key, updates[key]);
            });
        } catch (e) {
            console.error("Batch save failed:", e);
        }
    }
    
    function saveUser() { if(currentUser) localStorage.setItem('nabung_user', JSON.stringify(currentUser)); else localStorage.removeItem('nabung_user'); }
    function saveSettings() { localStorage.setItem('nabung_settings', JSON.stringify(settings)); applyTheme(); }
    function applyTheme() {
        if(settings.theme === 'dark') document.body.classList.remove('light');
        else document.body.classList.add('light');
    }

    // Proxy fetch skeleton for future Privacy Hardening
    function fetchThroughProxy(url, options = {}) {
        if (!NETWORK_CONFIG.proxyEnabled) {
            return fetch(url, options);
        }
        const proxyOptions = {
            ...options,
            headers: {
                ...(options.headers || {}),
                ...NETWORK_CONFIG.customHeaders
            }
        };
        return fetch(NETWORK_CONFIG.proxyUrl + '?url=' + encodeURIComponent(url), proxyOptions);
    }

    function formatValue(num) {
        const curr = settings.currency || 'IDR';
        const config = CURRENCY_CONFIG[curr] || CURRENCY_CONFIG.IDR;
        return config.symbol + ' ' + num.toLocaleString(config.locale, { minimumFractionDigits: config.decimal, maximumFractionDigits: config.decimal });
    }
    function formatRupiah(num) { return formatValue(num); }
    function escapeHtml(str) { if(!str) return ''; return str.replace(/[&<>]/g, function(m){ return m==='&'?'&amp;': m==='<'?'&lt;':'&gt;'; }); }
    function sanitizeTextInput(value, maxLen) {
        const raw = String(value ?? '');
        const noCtl = raw.replace(/[\u0000-\u001F\u007F]/g, ' ');
        const normalized = noCtl.replace(/\s+/g, ' ').trim();
        return normalized.slice(0, maxLen || 500);
    }
    function sanitizeEmailInput(value) {
        return sanitizeTextInput(value, 254).toLowerCase();
    }
    function normalizeVaultBlock(block) {
        if (!block || typeof block !== 'object') return { targets: [], transactions: [] };
        const safeTargets = Array.isArray(block.targets) ? block.targets.filter(function (x) { return x && typeof x === 'object'; }) : [];
        const safeTransactions = Array.isArray(block.transactions) ? block.transactions.filter(function (x) { return x && typeof x === 'object'; }) : [];
        return { targets: safeTargets, transactions: safeTransactions };
    }

    function openLegalModal(which) {
        const titleKey = which === 'tos' ? 'legalTosTitle' : which === 'privacy' ? 'legalPrivacyTitle' : 'legalHelpTitle';
        const bodyKey = which === 'tos' ? 'legalTosHtml' : which === 'privacy' ? 'legalPrivacyHtml' : 'legalHelpHtml';
        const modal = document.getElementById('globalModal');
        const modalContent = document.getElementById('modalContent');
        const title = t(titleKey);
        const bodyHtml = t(bodyKey);
        modalContent.innerHTML = '<h3 style="color:#e63946;margin:0 0 4px 0;text-align:left;">' + escapeHtml(title) + '</h3>' +
            '<div class="legal-modal-body">' + bodyHtml + '</div>' +
            '<button type="button" id="closeLegalModal" class="btn-outline" style="margin-top:16px;width:100%;">' + escapeHtml(t('legalClose')) + '</button>';
        modal.classList.add('active');
        document.getElementById('closeLegalModal').onclick = function () {
            modal.classList.remove('active');
        };
    }

    function showToast(msg) {
        // Remove existing toast
        const existingToast = document.querySelector('.toast-notification');
        if (existingToast) existingToast.remove();
        
        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        const checkSpan = document.createElement('span');
        checkSpan.textContent = '✓';
        const msgSpan = document.createElement('span');
        msgSpan.textContent = msg;
        toast.appendChild(checkSpan);
        toast.appendChild(msgSpan);
        
        document.body.appendChild(toast);
        
        // Trigger reflow and show
        void toast.offsetWidth;
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
        
        // Auto-hide after 2 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 2000);
    }

    function showModalMsg(content, isHtml=false) {
        const modal = document.getElementById('globalModal');
        const modalContent = document.getElementById('modalContent');
        if (isHtml) {
            // Only allow specific safe HTML for charts
            if (content.includes('<canvas')) {
                modalContent.innerHTML = content;
                const chartCloseBtn = document.getElementById('closeChartModal');
                if (chartCloseBtn) {
                    chartCloseBtn.addEventListener('click', () => modal.classList.remove('active'));
                }
            } else {
                // Fall back to text content for safety
                modalContent.innerHTML = '';
                const msg = document.createElement('div');
                msg.textContent = content.replace(/<[^>]*>/g, ''); // Strip all HTML tags
                msg.style.whiteSpace = 'pre-line';
                const close = document.createElement('button');
                close.id = 'closeModalBtn';
                close.className = 'btn-outline';
                close.type = 'button';
                close.textContent = t('legalClose');
                modalContent.appendChild(msg);
                modalContent.appendChild(close);
            }
        } else {
            modalContent.innerHTML = '';
            const msg = document.createElement('div');
            msg.textContent = String(content || '');
            msg.style.whiteSpace = 'pre-line';
            const close = document.createElement('button');
            close.id = 'closeModalBtn';
            close.className = 'btn-outline';
            close.type = 'button';
            close.textContent = t('legalClose');
            modalContent.appendChild(msg);
            modalContent.appendChild(close);
        }
        modal.classList.add('active');
        document.getElementById('closeModalBtn')?.addEventListener('click', ()=>modal.classList.remove('active'));
    }

    // ======================= SMART PREDICTION LOGIC =======================
    function updatePredictionTab() {
        if (targets.length === 0) {
            showModalMsg(t('noTargetYet'));
            return;
        }

        const frag = document.createDocumentFragment();
        const container = document.createElement('div');
        container.style.cssText = 'padding: 16px; max-height: 70vh; overflow-y: auto;';

        const title = document.createElement('h3');
        title.textContent = t('predictionTitle');
        title.style.cssText = 'color: #e63946; margin-bottom: 16px; text-align: center;';
        container.appendChild(title);

        let hasValidPrediction = false;

        targets.forEach(function(target) {
            const remaining = target.targetNominal - target.collected;
            if (remaining <= 0) return;

            const routineAmount = target.routineAmount || 0;
            let etaMonths = null;
            let etaDays = null;
            let statusSentiment = '';
            let statusColor = '#ff3366';

            if (routineAmount > 0) {
                const daysNeeded = Math.ceil(remaining / routineAmount);
                etaDays = daysNeeded;
                etaMonths = (daysNeeded / 30).toFixed(1);

                if (etaMonths < 3) {
                    statusSentiment = t('onTrack');
                    statusColor = '#ff3366';
                } else if (etaMonths < 6) {
                    statusSentiment = t('monitor');
                    statusColor = '#ffaa44';
                } else {
                    statusSentiment = t('needAction');
                    statusColor = '#ffaa44';
                }
            } else {
                statusSentiment = t('needAction');
                statusColor = '#ffaa44';
            }

            hasValidPrediction = true;
            const card = document.createElement('div');
            card.className = 'glass-card';
            card.style.cssText = 'margin-bottom: 12px; padding: 16px; border: 1px solid rgba(255, 51, 102, 0.3);';

            const nameEl = document.createElement('div');
            nameEl.style.cssText = 'font-weight: bold; color: #ff3366; margin-bottom: 8px; font-size: 1.1rem;';
            nameEl.textContent = target.name;
            card.appendChild(nameEl);

            const remainingEl = document.createElement('div');
            remainingEl.style.cssText = 'font-size: 0.9rem; color: var(--text-light); margin-bottom: 4px;';
            remainingEl.textContent = t('progressLabel') + ': ' + formatRupiah(remaining);
            card.appendChild(remainingEl);

            const routineEl = document.createElement('div');
            routineEl.style.cssText = 'font-size: 0.85rem; color: var(--text-dim); margin-bottom: 8px;';
            routineEl.textContent = t('routineLabel') + ': ' + (routineAmount > 0 ? formatRupiah(routineAmount) : t('notSet'));
            card.appendChild(routineEl);

            if (etaDays !== null) {
                const etaEl = document.createElement('div');
                etaEl.style.cssText = 'font-size: 0.9rem; color: var(--text-light); margin-bottom: 4px;';
                etaEl.textContent = t('etaLabel') + ': ' + etaDays + ' ' + t('periodsLabel') + ' (' + etaMonths + ' ' + t('monthsUnit') + ')';
                card.appendChild(etaEl);
            }

            const statusEl = document.createElement('div');
            statusEl.style.cssText = 'font-size: 0.9rem; font-weight: bold; color: ' + statusColor + ';';
            statusEl.textContent = t('statusLabel') + ': ' + statusSentiment;
            card.appendChild(statusEl);

            frag.appendChild(card);
        });

        if (!hasValidPrediction) {
            const noDataEl = document.createElement('div');
            noDataEl.style.cssText = 'text-align: center; color: var(--text-dim); padding: 20px;';
            noDataEl.textContent = t('noPredictionData');
            frag.appendChild(noDataEl);
        }

        container.appendChild(frag);

        const modalContent = document.getElementById('modalContent');
        modalContent.innerHTML = '';
        modalContent.appendChild(container);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'btn-outline';
        closeBtn.type = 'button';
        closeBtn.textContent = t('legalClose');
        closeBtn.style.cssText = 'width: 100%; margin-top: 16px;';
        closeBtn.addEventListener('click', () => {
            document.getElementById('globalModal').classList.remove('active');
        });
        modalContent.appendChild(closeBtn);

        document.getElementById('globalModal').classList.add('active');
    }

    // ======================= RENDER TARGET =======================
    function getScheduleLabel(schedule) {
        const map = {
            'daily': t('scheduleDaily'),
            'monday': t('scheduleMonday'),
            'tuesday': t('scheduleTuesday'),
            'wednesday': t('scheduleWednesday'),
            'thursday': t('scheduleThursday'),
            'friday': t('scheduleFriday'),
            'saturday': t('scheduleSaturday'),
            'sunday': t('scheduleSunday'),
            'weekdays': t('scheduleWeekdays'),
            'weekend': t('scheduleWeekend'),
            'flexible': t('scheduleFlexible')
        };
        return map[schedule] || t('scheduleFlexible');
    }

    function renderMainUI() {
        const grid = document.getElementById('targetsGrid');
        if (!grid) return;
        // Apply grid-mode or freeform-mode class based on layout mode
        if (settings.layoutMode === 'grid') {
            grid.classList.add('grid-mode');
            grid.classList.remove('freeform-mode');
        } else if (settings.layoutMode === 'freeform') {
            grid.classList.add('freeform-mode');
            grid.classList.remove('grid-mode');
        } else {
            grid.classList.remove('grid-mode');
            grid.classList.remove('freeform-mode');
        }
        const frag = document.createDocumentFragment();
        // Get hidden cards from localStorage
        const hiddenCards = JSON.parse(localStorage.getItem('hidden_cards') || '[]');
        // Sort targets based on layout mode
        const sortedTargets = [...targets].sort((a, b) => {
            // Pinned cards always first
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            // For grid mode, respect position property (for drag-and-drop swaps)
            if (settings.layoutMode === 'grid') {
                return (a.position || 0) - (b.position || 0);
            }
            // For freeform mode, sort by ID (default)
            return a.id - b.id;
        });
        sortedTargets.forEach(function (target) {
            if (!currentUser) return;
            // Skip rendering hidden cards
            if (hiddenCards.includes(target.id)) return;
            const collected = transactions.filter(t => t.targetId === target.id).reduce((sum, t) => sum + t.amount, 0);
            const percent = target.targetNominal > 0 ? (collected / target.targetNominal) * 100 : 0;
            let remainingDays = null;
            if (target.deadline) {
                const today = new Date();
                const deadlineDate = new Date(target.deadline);
                today.setHours(0,0,0,0);
                const diffTime = deadlineDate - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                remainingDays = diffDays > 0 ? diffDays : (diffDays === 0 ? 0 : null);
            }

            const card = document.createElement('div');
            card.className = 'target-card';
            card.dataset.id = String(target.id);

            // Card header with close and pin buttons
            const cardHeader = document.createElement('div');
            cardHeader.className = 'card-header';
            cardHeader.style.display = 'flex';
            cardHeader.style.justifyContent = 'space-between';
            cardHeader.style.alignItems = 'center';
            cardHeader.style.marginBottom = '8px';

            const leftHeader = document.createElement('div');
            const pinBtn = document.createElement('button');
            pinBtn.className = 'pin-btn';
            pinBtn.type = 'button';
            pinBtn.textContent = target.pinned ? '📌' : '📍';
            pinBtn.title = target.pinned ? 'Unpin' : 'Pin';
            pinBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                togglePin(target.id);
            });
            leftHeader.appendChild(pinBtn);

            const rightHeader = document.createElement('div');
            rightHeader.style.display = 'flex';
            rightHeader.style.gap = '4px';

            const closeBtn = document.createElement('button');
            closeBtn.className = 'close-card-btn';
            closeBtn.type = 'button';
            closeBtn.textContent = '×';
            closeBtn.title = 'Close';
            closeBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                hideCard(target.id);
            });
            rightHeader.appendChild(closeBtn);

            const dragHandle = document.createElement('div');
            dragHandle.className = 'drag-handle';
            dragHandle.textContent = '⋮⋮';
            dragHandle.title = 'Drag to move';
            rightHeader.appendChild(dragHandle);

            // Make card draggable
            card.setAttribute('draggable', 'true');
            card.addEventListener('dragstart', handleDragStart);
            card.addEventListener('dragend', handleDragEnd);
            card.addEventListener('dragover', handleDragOver);
            card.addEventListener('drop', handleDrop);

            cardHeader.appendChild(leftHeader);
            cardHeader.appendChild(rightHeader);
            card.appendChild(cardHeader);

            // Apply absolute positioning in Freeform mode
            if (settings.layoutMode === 'freeform' && target.x !== null && target.y !== null) {
                card.style.left = target.x + 'px';
                card.style.top = target.y + 'px';
            } else if (settings.layoutMode === 'freeform') {
                // Default position if not set
                const index = sortedTargets.indexOf(target);
                card.style.left = (index % 3) * 280 + 'px';
                card.style.top = Math.floor(index / 3) * 350 + 'px';
            }

            // Image or Icon display
            if (target.image) {
                const img = document.createElement('img');
                img.className = 'target-card-image';
                img.src = target.image;
                img.alt = target.name || '';
                card.appendChild(img);
            } else {
                const iconFallback = document.createElement('div');
                iconFallback.className = 'target-card-icon-fallback';
                iconFallback.textContent = '🎯';
                card.appendChild(iconFallback);
            }

            const title = document.createElement('h3');
            title.textContent = target.name || '-';
            card.appendChild(title);

            const desc = document.createElement('p');
            desc.style.fontSize = '0.8rem';
            desc.textContent = target.desc || '';
            card.appendChild(desc);

            if (target.schedule) {
                const scheduleInfo = document.createElement('div');
                scheduleInfo.className = 'schedule-badge';
                scheduleInfo.textContent = `📅 ${getScheduleLabel(target.schedule)} ${target.routineAmount ? formatRupiah(target.routineAmount) : ''}`;
                card.appendChild(scheduleInfo);
            }

            const progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            const progressFill = document.createElement('div');
            progressFill.className = 'progress-fill';
            progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
            progressBar.appendChild(progressFill);
            card.appendChild(progressBar);

            const amountLine = document.createElement('div');
            amountLine.textContent = `${formatRupiah(target.collected)} / ${formatRupiah(target.targetNominal)} (${percent.toFixed(1)}%)`;
            card.appendChild(amountLine);

            if (remainingDays !== null) {
                const remaining = document.createElement('div');
                remaining.textContent = `⏳ ${remainingDays} ${t('dayUnit')}`;
                card.appendChild(remaining);
            }

            const actions = document.createElement('div');
            actions.className = 'card-actions';
            actions.style.display = 'flex';
            actions.style.justifyContent = 'space-between';
            actions.style.gap = '8px';
            actions.style.marginTop = '12px';

            const leftActions = document.createElement('div');
            leftActions.style.display = 'flex';
            leftActions.style.gap = '8px';

            const editBtn = document.createElement('button');
            editBtn.className = 'edit-btn';
            editBtn.type = 'button';
            editBtn.textContent = '✏️ ' + t('editGoal');
            editBtn.addEventListener('click', function () { openEditTargetModal(target.id); });
            leftActions.appendChild(editBtn);

            const setorBtn = document.createElement('button');
            setorBtn.className = 'icon-btn setor-btn';
            setorBtn.dataset.id = String(target.id);
            setorBtn.type = 'button';
            setorBtn.textContent = t('btnDeposit');
            setorBtn.addEventListener('click', function () { openSetorModal(target.id); });
            leftActions.appendChild(setorBtn);

            actions.appendChild(leftActions);

            const rightActions = document.createElement('div');
            rightActions.style.display = 'flex';
            rightActions.style.gap = '8px';

            if (!target.completed) {
                const completeBtn = document.createElement('button');
                completeBtn.className = 'icon-btn complete-btn';
                completeBtn.dataset.id = String(target.id);
                completeBtn.type = 'button';
                completeBtn.textContent = t('btnComplete');
                completeBtn.addEventListener('click', function () { completeTarget(target.id); });
                rightActions.appendChild(completeBtn);
            } else {
                const done = document.createElement('span');
                done.textContent = t('statusDone');
                rightActions.appendChild(done);
            }
            actions.appendChild(rightActions);
            card.appendChild(actions);
            frag.appendChild(card);
        });
        grid.replaceChildren(frag);

        // Toggle empty state message visibility based on visible targets
        const emptyStateMsg = document.getElementById('emptyStateMsg');
        const visibleTargets = sortedTargets.filter(t => !hiddenCards.includes(t.id));
        if (emptyStateMsg) {
            if (visibleTargets.length === 0) {
                emptyStateMsg.style.display = 'block';
            } else {
                emptyStateMsg.style.display = 'none';
            }
        }

        // Add drop zone event listeners to grid container for Freeform mode
        if (settings.layoutMode === 'freeform') {
            grid.addEventListener('dragover', handleGridDragOver);
            grid.addEventListener('drop', handleGridDrop);
        } else {
            grid.removeEventListener('dragover', handleGridDragOver);
            grid.removeEventListener('drop', handleGridDrop);
        }
    }

    function handleGridDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        return false;
    }

    function handleGridDrop(e) {
        e.preventDefault();
        e.stopPropagation();

        const draggedTarget = targets.find(t => t.id === parseInt(draggedCardId));

        if (settings.layoutMode === 'freeform' && draggedTarget) {
            // Calculate drop position relative to grid container
            const grid = document.getElementById('targetsGrid');
            const rect = grid.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Check for collision and find non-overlapping position
            const safePosition = findNonOverlappingPosition(x, y, draggedTarget.id);

            // Update target coordinates
            draggedTarget.x = safePosition.x;
            draggedTarget.y = safePosition.y;

            saveTargets();
            renderMainUI();
        }

        return false;
    }

    function togglePin(id) {
        const target = targets.find(t => t.id === id);
        if(target) {
            target.pinned = !target.pinned;
            saveTargets();
            renderMainUI();
        }
    }

    function hideCard(id) {
        const card = document.querySelector(`.target-card[data-id="${id}"]`);
        if(card) {
            card.style.display = 'none';
            // Store hidden state in localStorage
            const hiddenCards = JSON.parse(localStorage.getItem('hidden_cards') || '[]');
            if(!hiddenCards.includes(id)) {
                hiddenCards.push(id);
                localStorage.setItem('hidden_cards', JSON.stringify(hiddenCards));
            }
        }
    }

    function showAllCards() {
        const hiddenCards = JSON.parse(localStorage.getItem('hidden_cards') || '[]');
        hiddenCards.forEach(id => {
            const card = document.querySelector(`.target-card[data-id="${id}"]`);
            if(card) card.style.display = '';
        });
        localStorage.removeItem('hidden_cards');
    }

    function checkCollision(x, y, targetId, cardWidth = 260, cardHeight = 320) {
        const margin = 10; // Minimum spacing between cards
        for (const target of targets) {
            if (target.id === targetId) continue;
            if (target.x === null || target.y === null) continue;

            // Check if the new position would overlap with existing card
            const xOverlap = x < target.x + cardWidth + margin && x + cardWidth + margin > target.x;
            const yOverlap = y < target.y + cardHeight + margin && y + cardHeight + margin > target.y;

            if (xOverlap && yOverlap) {
                return true; // Collision detected
            }
        }
        return false; // No collision
    }

    function findNonOverlappingPosition(x, y, targetId, cardWidth = 260, cardHeight = 320) {
        let newX = x;
        let newY = y;
        let attempts = 0;
        const maxAttempts = 50;
        const step = 20;

        while (checkCollision(newX, newY, targetId, cardWidth, cardHeight) && attempts < maxAttempts) {
            // Try positions in a spiral pattern
            if (attempts % 2 === 0) {
                newX += step;
            } else {
                newY += step;
            }
            attempts++;
        }

        return { x: newX, y: newY };
    }

    let draggedCard = null;
    let draggedCardId = null;
    const GRID_SIZE = 20; // Snap to grid size in pixels

    function handleDragStart(e) {
        draggedCard = this;
        draggedCardId = this.dataset.id;
        this.classList.add('dragging');
        // Add dragging class to grid container to show grid overlay
        const grid = document.getElementById('targetsGrid');
        if (grid && settings.layoutMode === 'grid') {
            grid.classList.add('dragging');
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.dataset.id);
    }

    function handleDragEnd(e) {
        this.classList.remove('dragging');
        // Remove dragging class from grid container to hide grid overlay
        const grid = document.getElementById('targetsGrid');
        if (grid) {
            grid.classList.remove('dragging');
        }
        draggedCard = null;
        draggedCardId = null;
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        return false;
    }

    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();

        const draggedTarget = targets.find(t => t.id === parseInt(draggedCardId));

        if (settings.layoutMode === 'freeform' && draggedTarget) {
            // Calculate drop position relative to grid container
            const grid = document.getElementById('targetsGrid');
            const rect = grid.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Check for collision and find non-overlapping position
            const safePosition = findNonOverlappingPosition(x, y, draggedTarget.id);

            // Update target coordinates
            draggedTarget.x = safePosition.x;
            draggedTarget.y = safePosition.y;

            saveTargets();
            renderMainUI();
        } else if (draggedCard !== this && draggedCardId !== this.dataset.id) {
            // Grid mode: swap positions
            const targetTarget = targets.find(t => t.id === parseInt(this.dataset.id));

            if (draggedTarget && targetTarget) {
                const draggedIndex = targets.indexOf(draggedTarget);
                const targetIndex = targets.indexOf(targetTarget);

                if (draggedIndex !== -1 && targetIndex !== -1) {
                    // Swap positions in the array
                    const temp = targets[draggedIndex];
                    targets.splice(draggedIndex, 1);
                    targets.splice(targetIndex, 0, temp);

                    // Update position property for grid mode
                    if (settings.layoutMode === 'grid') {
                        // Reassign positions based on new array order
                        targets.forEach((t, idx) => {
                            t.position = idx;
                        });
                    }

                    saveTargets();
                    renderMainUI();
                }
            }
        }

        return false;
    }

    function completeTarget(id) {
        const target = targets.find(t => t.id === id);
        if(target && !target.completed) {
            target.completed = true;
            target.collected = target.targetNominal;
            saveTargets();
            // Lazy load canvas-confetti only when needed
            if (typeof canvasConfetti === 'undefined') {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1';
                script.onload = () => {
                    canvasConfetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#ff3366', '#ffaa44'] });
                };
                document.head.appendChild(script);
            } else {
                canvasConfetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#ff3366', '#ffaa44'] });
            }
            renderMainUI();
            showToast(t('targetReachedToast'));
        }
    }

    function openSetorModal(targetId) {
        const target = targets.find(t => t.id === targetId);
        if(!target) return;
        const modal = document.getElementById('globalModal');
        const modalContent = document.getElementById('modalContent');
        modalContent.innerHTML = '';
        const title = document.createElement('h3');
        title.textContent = tWithParams('modalSetorTitle', { name: target.name });
        const amountInput = document.createElement('input');
        amountInput.type = 'number';
        amountInput.id = 'setorAmount';
        amountInput.placeholder = t('setorAmountPlaceholder');
        const noteInput = document.createElement('input');
        noteInput.type = 'text';
        noteInput.id = 'setorNote';
        noteInput.placeholder = t('setorNotePlaceholder');
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn-primary';
        confirmBtn.id = 'confirmSetor';
        confirmBtn.type = 'button';
        confirmBtn.style.marginTop = '16px';
        confirmBtn.textContent = t('setorNowBtn');
        const closeBtn = document.createElement('button');
        closeBtn.className = 'btn-outline';
        closeBtn.id = 'closeModalBtn';
        closeBtn.type = 'button';
        closeBtn.textContent = t('cancelBtn');
        modalContent.appendChild(title);
        modalContent.appendChild(amountInput);
        modalContent.appendChild(noteInput);
        modalContent.appendChild(confirmBtn);
        modalContent.appendChild(closeBtn);
        modal.classList.add('active');
        document.getElementById('confirmSetor').onclick = () => {
            let amount = validateNumericInput(document.getElementById('setorAmount').value, 1, Number.MAX_SAFE_INTEGER);
            if(amount === null) { alert(t('invalidAmount')); return; }
            const note = sanitizeTextInput(document.getElementById('setorNote').value, 240);
            target.collected = Math.min(target.targetNominal, target.collected + amount);
            transactions.unshift({ targetId: target.id, amount, date: new Date().toISOString(), note });
            saveTargets();
            saveTransactions();
            renderMainUI();
            modal.classList.remove('active');
            showToast(tWithParams('depositSuccess', { amount: formatRupiah(amount) }));
            if(target.collected >= target.targetNominal && !target.completed) completeTarget(target.id);
        };
        document.getElementById('closeModalBtn').onclick = () => modal.classList.remove('active');
    }

    // Image compression helper (async with requestIdleCallback for better mobile performance)
    function compressImageToBase64(file, maxWidth = 400, maxHeight = 300, quality = 0.6) {
        return new Promise(function(resolve, reject) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = new Image();
                img.onload = function() {
                    // Use requestIdleCallback to avoid blocking main thread on mobile
                    const processImage = function() {
                        const canvas = document.createElement('canvas');
                        let width = img.width;
                        let height = img.height;
                        if (width > maxWidth) {
                            height = Math.floor(height * (maxWidth / width));
                            width = maxWidth;
                        }
                        if (height > maxHeight) {
                            width = Math.floor(width * (maxHeight / height));
                            height = maxHeight;
                        }
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);
                        resolve(canvas.toDataURL('image/jpeg', quality));
                    };
                    
                    if ('requestIdleCallback' in window) {
                        requestIdleCallback(() => processImage(), { timeout: 2000 });
                    } else {
                        setTimeout(processImage, 0);
                    }
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function openAddTargetModal() {
        const modal = document.getElementById('globalModal');
        const modalContent = document.getElementById('modalContent');
        modalContent.innerHTML = `
            <h3>${escapeHtml(t('addTargetTitle'))}</h3>
            <input id="targetName" placeholder="${escapeHtml(t('targetNamePlaceholder'))}" style="display:block;width:100%;margin-bottom:10px;" />
            <label for="targetDesc" style="display:block;text-align:left;margin-bottom:5px;margin-top:2px;">${escapeHtml(t('targetDescLabel'))}</label>
            <textarea id="targetDesc" placeholder="${escapeHtml(t('targetDescPlaceholder'))}" style="display:block;width:100%;margin-bottom:10px;"></textarea>
            <label class="image-upload-label" for="targetImage">${escapeHtml(t('uploadImage'))} (${escapeHtml(t('optional'))})</label>
            <input id="targetImage" type="file" accept="image/*" style="display:block;width:100%;margin-bottom:10px;" />
            <div id="imagePreviewContainer" class="image-preview-container" style="display:none;"></div>
            <input id="targetAmount" type="number" placeholder="${escapeHtml(t('targetAmountPlaceholder'))}" style="display:block;width:100%;margin-bottom:10px;" />
            <select id="targetSchedule" style="display:block;width:100%;margin-bottom:10px;">
                <option value="daily">${escapeHtml(t('scheduleDaily'))}</option>
                <option value="monday">${escapeHtml(t('scheduleMonday'))}</option><option value="tuesday">${escapeHtml(t('scheduleTuesday'))}</option>
                <option value="wednesday">${escapeHtml(t('scheduleWednesday'))}</option><option value="thursday">${escapeHtml(t('scheduleThursday'))}</option>
                <option value="friday">${escapeHtml(t('scheduleFriday'))}</option><option value="saturday">${escapeHtml(t('scheduleSaturday'))}</option>
                <option value="sunday">${escapeHtml(t('scheduleSunday'))}</option>
                <option value="weekdays">${escapeHtml(t('scheduleWeekdays'))}</option>
                <option value="weekend">${escapeHtml(t('scheduleWeekend'))}</option>
                <option value="flexible">${escapeHtml(t('scheduleFlexible'))}</option>
            </select>
            <input id="routineAmount" type="number" placeholder="${escapeHtml(t('routineAmountPlaceholder'))}" style="display:block;width:100%;margin-bottom:10px;" />
            <input id="targetDeadline" type="date" placeholder="${escapeHtml(t('deadlinePlaceholder'))}" style="display:block;width:100%;margin-bottom:10px;" />
            <button class="btn-primary" id="createTargetBtn">${escapeHtml(t('createTargetBtn'))}</button>
            <button class="btn-outline" id="cancelModalBtn">${escapeHtml(t('cancelBtn'))}</button>
        `;
        modal.classList.add('active');
        
        // Image preview handler
        const imageInput = document.getElementById('targetImage');
        const previewContainer = document.getElementById('imagePreviewContainer');
        let currentBase64Image = null;
        imageInput.addEventListener('change', function() {
            const file = this.files[0];
            if (file) {
                compressImageToBase64(file).then(function(base64) {
                    currentBase64Image = base64;
                    previewContainer.innerHTML = `<img src="${base64}" class="image-preview-thumb" alt="Preview" />`;
                    previewContainer.style.display = 'block';
                }).catch(function(err) {
                    console.error('Image compression failed:', err);
                });
            } else {
                currentBase64Image = null;
                previewContainer.style.display = 'none';
                previewContainer.innerHTML = '';
            }
        });
        
        document.getElementById('createTargetBtn').onclick = () => {
            const name = sanitizeTextInput(document.getElementById('targetName').value, 80);
            const desc = sanitizeTextInput(document.getElementById('targetDesc').value, 300);
            const nominal = validateNumericInput(document.getElementById('targetAmount').value, 1, Number.MAX_SAFE_INTEGER);
            const schedule = document.getElementById('targetSchedule').value;
            const routineAmount = validateNumericInput(document.getElementById('routineAmount').value, 0, Number.MAX_SAFE_INTEGER);
            const deadline = document.getElementById('targetDeadline').value;
            if(!name || nominal === null) { alert(t('createTargetInvalid')); return; }
            const newId = Date.now();
            targets.push({
                id: newId, name, desc, targetNominal: nominal, collected: 0,
                deadline: deadline || null, completed: false, schedule: schedule,
                routineAmount: isNaN(routineAmount) ? 0 : routineAmount,
                image: currentBase64Image || null,
                createdAt: new Date().toISOString(),
                position: targets.length, // Add position for custom ordering
                pinned: false,
                x: null, // x coordinate for freeform mode
                y: null  // y coordinate for freeform mode
            });
            saveTargets();
            renderMainUI();
            modal.classList.remove('active');
            showToast(tWithParams('createTargetSuccess', { name: name }));
        };
        document.getElementById('cancelModalBtn').onclick = () => modal.classList.remove('active');
    }

    function openEditTargetModal(targetId) {
        const target = targets.find(t => t.id === targetId);
        if (!target) return;
        
        const modal = document.getElementById('globalModal');
        const modalContent = document.getElementById('modalContent');
        modalContent.innerHTML = `
            <h3>✏️ Edit Target: ${escapeHtml(target.name)}</h3>
            <input id="editTargetName" value="${escapeHtml(target.name)}" style="display:block;width:100%;margin-bottom:10px;" />
            <label for="editTargetDesc" style="display:block;text-align:left;margin-bottom:5px;margin-top:2px;">${escapeHtml(t('targetDescLabel'))}</label>
            <textarea id="editTargetDesc" style="display:block;width:100%;margin-bottom:10px;">${escapeHtml(target.desc || '')}</textarea>
            <label class="image-upload-label" for="editTargetImage">${escapeHtml(t('uploadImage'))} (${escapeHtml(t('optional'))})</label>
            <input id="editTargetImage" type="file" accept="image/*" style="display:block;width:100%;margin-bottom:10px;" />
            <div id="editImagePreviewContainer" class="image-preview-container"></div>
            <input id="editTargetAmount" type="number" value="${target.targetNominal}" placeholder="${escapeHtml(t('targetAmountPlaceholder'))}" style="display:block;width:100%;margin-bottom:10px;" />
            <select id="editTargetSchedule" style="display:block;width:100%;margin-bottom:10px;">
                <option value="daily"${target.schedule === 'daily' ? ' selected' : ''}>${escapeHtml(t('scheduleDaily'))}</option>
                <option value="monday"${target.schedule === 'monday' ? ' selected' : ''}>${escapeHtml(t('scheduleMonday'))}</option>
                <option value="tuesday"${target.schedule === 'tuesday' ? ' selected' : ''}>${escapeHtml(t('scheduleTuesday'))}</option>
                <option value="wednesday"${target.schedule === 'wednesday' ? ' selected' : ''}>${escapeHtml(t('scheduleWednesday'))}</option>
                <option value="thursday"${target.schedule === 'thursday' ? ' selected' : ''}>${escapeHtml(t('scheduleThursday'))}</option>
                <option value="friday"${target.schedule === 'friday' ? ' selected' : ''}>${escapeHtml(t('scheduleFriday'))}</option>
                <option value="saturday"${target.schedule === 'saturday' ? ' selected' : ''}>${escapeHtml(t('scheduleSaturday'))}</option>
                <option value="sunday"${target.schedule === 'sunday' ? ' selected' : ''}>${escapeHtml(t('scheduleSunday'))}</option>
                <option value="weekdays"${target.schedule === 'weekdays' ? ' selected' : ''}>${escapeHtml(t('scheduleWeekdays'))}</option>
                <option value="weekend"${target.schedule === 'weekend' ? ' selected' : ''}>${escapeHtml(t('scheduleWeekend'))}</option>
                <option value="flexible"${target.schedule === 'flexible' ? ' selected' : ''}>${escapeHtml(t('scheduleFlexible'))}</option>
            </select>
            <input id="editRoutineAmount" type="number" value="${target.routineAmount || ''}" placeholder="${escapeHtml(t('routineAmountPlaceholder'))}" style="display:block;width:100%;margin-bottom:10px;" />
            <input id="editTargetDeadline" type="date" value="${target.deadline || ''}" style="display:block;width:100%;margin-bottom:10px;" />
            <button class="btn-primary" id="saveEditTargetBtn">💾 Simpan Perubahan</button>
            <button class="btn-outline" id="cancelEditModalBtn">${escapeHtml(t('cancelBtn'))}</button>
        `;
        modal.classList.add('active');
        
        // Show existing image preview
        const editPreviewContainer = document.getElementById('editImagePreviewContainer');
        let editBase64Image = target.image || null;
        if (editBase64Image) {
            editPreviewContainer.innerHTML = `<img src="${editBase64Image}" class="image-preview-thumb" alt="Current Image" />`;
        }
        
        // Handle new image upload
        const editImageInput = document.getElementById('editTargetImage');
        editImageInput.addEventListener('change', function() {
            const file = this.files[0];
            if (file) {
                compressImageToBase64(file).then(function(base64) {
                    editBase64Image = base64;
                    editPreviewContainer.innerHTML = `<img src="${base64}" class="image-preview-thumb" alt="New Preview" />`;
                }).catch(function(err) {
                    console.error('Image compression failed:', err);
                });
            }
        });
        
        document.getElementById('saveEditTargetBtn').onclick = () => {
            const name = sanitizeTextInput(document.getElementById('editTargetName').value, 80);
            const desc = sanitizeTextInput(document.getElementById('editTargetDesc').value, 300);
            const nominal = validateNumericInput(document.getElementById('editTargetAmount').value, 1, Number.MAX_SAFE_INTEGER);
            const schedule = document.getElementById('editTargetSchedule').value;
            const routineAmount = validateNumericInput(document.getElementById('editRoutineAmount').value, 0, Number.MAX_SAFE_INTEGER);
            const deadline = document.getElementById('editTargetDeadline').value;
            if(!name || nominal === null) { alert(t('createTargetInvalid')); return; }
            
            // Update existing target
            target.name = name;
            target.desc = desc;
            target.targetNominal = nominal;
            target.schedule = schedule;
            target.routineAmount = isNaN(routineAmount) ? 0 : routineAmount;
            target.deadline = deadline || null;
            target.image = editBase64Image;
            
            saveTargets();
            renderMainUI();
            modal.classList.remove('active');
            showToast('✅ Target diperbarui!');
        };
        document.getElementById('cancelEditModalBtn').onclick = () => modal.classList.remove('active');
    }

    // ======================= CHAT AI DENGAN PILIHAN MODEL =======================
    function openAIChat() {
        const modal = document.getElementById('globalModal');
        const modalContent = document.getElementById('modalContent');
        modalContent.innerHTML = `
            <style>
                /* Custom scrollbar for AI chat */
                #chatMessages::-webkit-scrollbar {
                    width: 8px;
                    background: transparent;
                }
                #chatMessages::-webkit-scrollbar-thumb {
                    background: rgba(255,51,102,0.25);
                    border-radius: 8px;
                    transition: background 0.3s;
                }
                #chatMessages:hover::-webkit-scrollbar-thumb,
                #chatMessages:active::-webkit-scrollbar-thumb {
                    background: rgba(255,51,102,0.42);
                }
                #chatMessages {
                    scrollbar-width: thin;
                    scrollbar-color: rgba(255,51,102,0.4) transparent;
                    /* Always match modal width and align right */
                    max-height: 300px;
                    min-height: 120px;
                    overflow-y: auto;
                    background: rgba(0,0,0,0.3);
                    border-radius: 24px;
                    padding: 12px;
                    margin-bottom: 12px;
                    font-size: 14px;
                    box-sizing: border-box;
                }
                /* Hide scrollbar by default (Firefox) */
                #chatMessages {
                    scrollbar-width: thin;
                    scrollbar-color: transparent transparent;
                }
                #chatMessages:hover {
                    scrollbar-color: rgba(255,51,102,0.42) transparent;
                }
                /* Hide scrollbar by default (Edge/Chrome) */
                #chatMessages::-webkit-scrollbar-thumb {
                    background: transparent;
                }
                #chatMessages:hover::-webkit-scrollbar-thumb,
                #chatMessages:active::-webkit-scrollbar-thumb {
                    background: rgba(255,51,102,0.4);
                }
            </style>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h3 id="aiChatTitle" style="color: #ff3366;">${escapeHtml(t('aiTitle'))}</h3>
                <button id="closeAIChat" style="background: none; border: none; font-size: 24px; cursor: pointer;">&times;</button>
            </div>
            <div style="margin-bottom: 16px;">
                <label id="aiModelLabel">${escapeHtml(t('aiModelLabel'))}</label>
                <select id="aiModelSelect" style="width: 100%; padding: 10px; border-radius: 28px; border: 1px solid #ff3366;">
                    <option value="gemini">Google Gemini (gemini-2.5-flash)</option>
                    <option value="grok">Grok (Llama 3 70B)</option>
                    <option value="huggingface">HuggingFace (Mistral-7B)</option>
                </select>
            </div>
            <div style="margin-bottom: 16px;">
                <label id="aiApiKeyLabel">${escapeHtml(t('aiApiKeyLabel'))}</label>
                <input type="password" id="apiKeyInput" placeholder="${escapeHtml(t('aiApiKeyPlaceholder'))}" />
                <div style="font-size: 12px; color: #aaa; margin-top: 4px;">
                    <span id="aiKeyHint">${escapeHtml(t('aiApiKeyHint'))}</span>
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color: #ff3366;">Gemini</a> | 
                    <a href="https://console.x.ai/home" target="_blank" style="color: #ff3366;">Grok</a> | 
                    <a href="https://huggingface.co/settings/tokens" target="_blank" style="color: #ff3366;">HuggingFace</a>
                </div>
            </div>
            <div id="chatMessages" class="chat-messages"></div>
            <div style="display: flex; gap: 8px;">
                <input type="text" id="aiInput" placeholder="${escapeHtml(t('aiPlaceholder'))}" style="flex: 1;" />
                <button id="sendChatBtn" class="btn-primary" style="width: auto; padding: 12px 20px; margin: 0;">${escapeHtml(t('aiSendBtn'))}</button>
            </div>
            <div id="typingIndicator" style="font-style: italic; color: #ff9999; margin-top: 8px; display: none;">${escapeHtml(t('aiThinking'))}</div>
        `;
        modal.classList.add('active');
        
        const closeBtn = document.getElementById('closeAIChat');
        const sendBtn = document.getElementById('sendChatBtn');
        const userInput = document.getElementById('aiInput');
        const modelSelect = document.getElementById('aiModelSelect');
        const apiKeyInput = document.getElementById('apiKeyInput');
        const chatMessagesDiv = document.getElementById('chatMessages');
        const typingDiv = document.getElementById('typingIndicator');
        
        // Load saved API key & model (with obfuscation)
        const savedApiKey = localStorage.getItem('ai_api_key');
        const savedModel = localStorage.getItem('ai_model');
        if(savedApiKey) apiKeyInput.value = deobfuscateApiKey(savedApiKey);
        if(savedModel) modelSelect.value = savedModel;
        
        modelSelect.addEventListener('change', () => localStorage.setItem('ai_model', modelSelect.value));
        apiKeyInput.addEventListener('input', () => localStorage.setItem('ai_api_key', obfuscateApiKey(apiKeyInput.value)));
        
        function addMessage(role, text) {
            const msgDiv = document.createElement('div');
            msgDiv.className = `chat-message ${role === 'user' ? 'chat-user' : 'chat-ai'}`;
            const label = document.createElement('strong');
            label.textContent = role === 'user' ? `${t('aiRoleUser')}: ` : `${t('aiRoleAssistant')}: `;
            const body = document.createElement('span');
            body.textContent = String(text || '');
            body.style.whiteSpace = 'pre-wrap';
            msgDiv.appendChild(label);
            msgDiv.appendChild(body);
            chatMessagesDiv.appendChild(msgDiv);
            chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
        }
        
        async function callAI(prompt) {
            const apiKey = apiKeyInput.value.trim();
            if(!apiKey) { addMessage('ai', t('aiNeedApiKey')); return null; }
            const model = modelSelect.value;
            try {
                if(model === 'gemini') {
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
                    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
                    const data = await res.json();
                    return data.candidates?.[0]?.content?.parts?.[0]?.text || `Error: ${data.error?.message || 'Gagal'}`;
                } else if(model === 'grok') {
                    const res = await fetch('https://api.grok.com/openai/v1/chat/completions', {
                        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ model: 'llama3-70b-8192', messages: [{ role: 'user', content: prompt }] })
                    });
                    const data = await res.json();
                    return data.choices?.[0]?.message?.content || `Error: ${data.error?.message || 'Gagal'}`;
                } else if(model === 'huggingface') {
                    const res = await fetch('https://api-inference.huggingface.co/models/meta-llama/Llama-3.1-8B-Instruct', {
                        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 500 } })
                    });
                    const data = await res.json();
                    return data[0]?.generated_text?.replace(prompt, '').trim() || `Error: ${data.error || 'Gagal'}`;
                }
            } catch(e) { return `${t('aiNetworkErrorPrefix')} ${e.message}`; }
            return t('aiUnknownModel');
        }
        
        async function sendMessage() {
            const message = userInput.value.trim();
            if(!message) return;
            addMessage('user', message);
            userInput.value = '';
            typingDiv.style.display = 'block';
            const reply = await callAI(message);
            typingDiv.style.display = 'none';
            if(reply) addMessage('ai', reply);
        }
        
        sendBtn.addEventListener('click', sendMessage);
        userInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') sendMessage(); });
        closeBtn.addEventListener('click', () => modal.classList.remove('active'));
        addMessage('ai', t('aiWelcome'));
    }

    // ======================= SIDEBAR & FITUR =======================
    function openSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        if (sidebar) sidebar.classList.add('open');
        if (overlay) {
            overlay.classList.add('active');
            overlay.setAttribute('aria-hidden', 'false');
        }
    }
    function closeSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) {
            overlay.classList.remove('active');
            overlay.setAttribute('aria-hidden', 'true');
        }
    }
    function toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;
        if (sidebar.classList.contains('open')) closeSidebar();
        else openSidebar();
    }
    // Export TXT Report function for Google Keep copy-paste
    function handleExportTxt() {
        try {
            let report = 'INFINITY SAVING - LAPORAN TARGET\n';
            report += '===================================\n\n';
            
            if (targets.length === 0) {
                report += 'Belum ada target nabung.\n';
            } else {
                targets.forEach((target, index) => {
                    const remaining = target.targetNominal - target.collected;
                    const routineAmount = target.routineAmount || 0;
                    let etaDays = null;
                    let etaMonths = null;
                    if (routineAmount > 0) {
                        etaDays = Math.ceil(remaining / routineAmount);
                        etaMonths = (etaDays / 30).toFixed(1);
                    }
                    const percentage = target.targetNominal > 0 ? ((target.collected / target.targetNominal) * 100).toFixed(1) : 0;
                    
                    report += (index + 1) + '. ' + target.name + '\n';
                    report += '   Target: ' + formatRupiah(target.targetNominal) + '\n';
                    report += '   Terkumpul: ' + formatRupiah(target.collected) + ' (' + percentage + '%)\n';
                    report += '   Sisa: ' + formatRupiah(remaining) + '\n';
                    if (routineAmount > 0) {
                        report += '   Setoran Rutin: ' + formatRupiah(routineAmount) + '\n';
                    }
                    if (etaDays !== null) {
                        report += '   Estimasi: ' + etaDays + ' hari (' + etaMonths + ' bulan)\n';
                    }
                    if (target.description) {
                        report += '   Deskripsi: ' + target.description + '\n';
                    }
                    report += '\n';
                });
            }
            
            report += '\n===================================\n';
            report += 'Dibuat pada: ' + new Date().toLocaleString() + '\n';
            
            const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'laporan-infinity-saving.txt';
            a.click();
            showToast(t('exportSuccess'));
        } catch (error) {
            console.error('Export Txt error:', error);
            showToast('Export failed');
        }
    }

    // Set active navigation item for visual feedback
    function setActiveNavItem(element) {
        document.querySelectorAll('.menu-item').forEach(item => {
            item.classList.remove('active-nav');
        });
        
        if (element && element.classList.contains('menu-item')) {
            element.classList.add('active-nav');
        }
    }

    function attachSidebarEvents() {
        const overlay = document.getElementById('sidebarOverlay');
        document.getElementById('closeSidebar').onclick = closeSidebar;
        if (overlay) overlay.onclick = closeSidebar;
        document.getElementById('fabAddTarget').onclick = openAddTargetModal;
        
        // Event delegation for menu items with active state
        document.getElementById('sidebar').addEventListener('click', function(e) {
            const menuItem = e.target.closest('.menu-item');
            if (menuItem) {
                setActiveNavItem(menuItem);
            }
        });
        
        document.querySelectorAll('[data-dropdown-toggle]').forEach(function (btn) {
            btn.onclick = function () {
                const targetId = btn.getAttribute('data-dropdown-toggle');
                const group = btn.closest('.menu-dropdown');
                if (!group) return;
                group.classList.toggle('open');
                const submenu = document.getElementById(targetId);
                if (!submenu) return;
                submenu.style.maxHeight = group.classList.contains('open') ? submenu.scrollHeight + 'px' : '0px';
            };
        });
        
        const aiBtn = document.getElementById('aiChatBtn');
        const newAiBtn = aiBtn.cloneNode(true);
        aiBtn.parentNode.replaceChild(newAiBtn, aiBtn);
        newAiBtn.addEventListener('click', openAIChat);
        
        document.getElementById('prediksiBtn').onclick = () => updatePredictionTab();
        
        // Chart instance tracking for memory leak prevention
        let chartInstance = null;

        document.getElementById('showChartBtn').onclick = () => {
            if(targets.length===0) { showModalMsg(t('noTargetYet')); return; }
            let labels = targets.map(t=>t.name);
            let collectedData = targets.map(t=>t.collected);
            let targetData = targets.map(t=>t.targetNominal);
            let html = `<canvas id="simpleChart" width="300" height="200"></canvas><button id="closeChartModal" class="btn-outline">${escapeHtml(t('legalClose'))}</button>`;
            showModalMsg(html, true);
            // Lazy load Chart.js only when needed
            if (typeof Chart === 'undefined') {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
                script.onload = () => {
                    setTimeout(()=>{
                        const ctx = document.getElementById('simpleChart')?.getContext('2d');
                        if(ctx) {
                            if (chartInstance) {
                                chartInstance.destroy();
                            }
                            chartInstance = new Chart(ctx, { type:'bar', data:{ labels, datasets:[{label:t('chartCollectedLabel'), data:collectedData, backgroundColor:'#ff3366'},{label:t('chartTargetLabel'), data:targetData, backgroundColor:'#aaa'}] } });
                        }
                    },50);
                };
                document.head.appendChild(script);
            } else {
                setTimeout(()=>{
                    const ctx = document.getElementById('simpleChart')?.getContext('2d');
                    if(ctx) {
                        if (chartInstance) {
                            chartInstance.destroy();
                        }
                        chartInstance = new Chart(ctx, { type:'bar', data:{ labels, datasets:[{label:t('chartCollectedLabel'), data:collectedData, backgroundColor:'#ff3366'},{label:t('chartTargetLabel'), data:targetData, backgroundColor:'#aaa'}] } });
                    }
                },50);
            }
        };
        document.getElementById('historyBtn').onclick = () => {
            if(transactions.length===0) showModalMsg(t('noHistoryYet'));
            else {
                let list = transactions.map(tx=>`${new Date(tx.date).toLocaleDateString()} - ${formatRupiah(tx.amount)} : ${tx.note||'-'}`).join('\n');
                showModalMsg(`${t('historyTitle')}\n${list}`);
            }
        };
        // Export JSON function
        function handleExportJson() {
            const data = { targets, transactions, settings };
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
            a.download = 'infinity-saving-data.json';
            a.click();
            showToast(t('exportSuccess'));
        }

        // Import Data function
        function handleImportData() {
            const fileInput = document.getElementById('importFileInput');
            if (fileInput) fileInput.click();
        }

        // Import functionality with validation and confirmation
        const importFileInputEl = document.getElementById('importFileInput');

        if (importFileInputEl) {
            importFileInputEl.onchange = function(e) {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = function(event) {
                try {
                    const importedData = JSON.parse(event.target.result);
                    // Validate the structure
                    if (!importedData || typeof importedData !== 'object') {
                        throw new Error('Invalid file format');
                    }
                    if (!Array.isArray(importedData.targets)) {
                        throw new Error('Missing targets array');
                    }
                    if (!Array.isArray(importedData.transactions)) {
                        throw new Error('Missing transactions array');
                    }
                    // Validate each target
                    for (let i = 0; i < importedData.targets.length; i++) {
                        const t = importedData.targets[i];
                        if (!t.name || typeof t.targetNominal !== 'number') {
                            throw new Error('Invalid target at index ' + i);
                        }
                    }
                    // Validate each transaction
                    for (let i = 0; i < importedData.transactions.length; i++) {
                        const tx = importedData.transactions[i];
                        if (typeof tx.amount !== 'number' || !tx.date) {
                            throw new Error('Invalid transaction at index ' + i);
                        }
                    }
                    // Show confirmation before overwriting
                    if (confirm(t('confirmImport'))) {
                        requestAnimationFrame(function() {
                            targets = importedData.targets;
                            transactions = importedData.transactions;
                            if (importedData.settings && typeof importedData.settings === 'object') {
                                settings = { ...settings, ...importedData.settings };
                            }
                            syncVaultFromMemory();
                            renderMainUI();
                            updatePredictionTab();
                            showToast(t('importSuccess'));
                        });
                    }
                } catch (err) {
                    showModalMsg(t('importFailed') + ': ' + err.message);
                } finally {
                    importFileInputEl.value = '';
                }
            };
            reader.onerror = function() {
                showModalMsg('❌ Gagal membaca file');
                importFileInputEl.value = '';
            };
            reader.readAsText(file);
        };
        }

        
        // Export/Import buttons event listeners (if they exist in sidebar)
        const exportJsonBtn = document.getElementById('exportJsonBtn');
        if (exportJsonBtn) {
            exportJsonBtn.onclick = function() {
                handleExportJson();
            };
        }
        const exportTxtBtn = document.getElementById('exportTxtBtn');
        if (exportTxtBtn) {
            exportTxtBtn.onclick = function() {
                handleExportTxt();
            };
        }
        const importDataBtn = document.getElementById('importDataBtn');
        if (importDataBtn) {
            importDataBtn.onclick = function() {
                handleImportData();
            };
        }
        
        // Side rail settings menu toggle
        const sideRailSettingsBtn = document.getElementById('sideRailSettingsBtn');
        if (sideRailSettingsBtn) {
            sideRailSettingsBtn.onclick = function() {
                const menu = document.getElementById('sideRailSettingsMenu');
                if (menu) {
                    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
                    if (menu.style.display === 'block') {
                        setTimeout(() => menu.classList.add('open'), 10);
                    } else {
                        menu.classList.remove('open');
                    }
                }
            };
        }
        
        // Side rail settings controls
        const sideRailCurrencySelect = document.getElementById('sideRailCurrencySelect');
        if (sideRailCurrencySelect) {
            sideRailCurrencySelect.addEventListener('change', function(e) {
                settings.currency = e.target.value;
                saveSettings();
                renderMainUI();
            });
        }
        const sideRailLangSelect = document.getElementById('sideRailLangSelect');
        if (sideRailLangSelect) {
            sideRailLangSelect.addEventListener('change', function(e) {
                applyLanguage(e.target.value);
            });
        }
        const sideRailDarkModeToggle = document.getElementById('sideRailDarkModeToggle');
        if (sideRailDarkModeToggle) {
            sideRailDarkModeToggle.addEventListener('change', function(e) {
                settings.theme = e.target.value;
                saveSettings();
                applyTheme();
            });
        }
        const layoutModeToggle = document.getElementById('layoutModeToggle');
        if (layoutModeToggle) {
            layoutModeToggle.addEventListener('change', function(e) {
                settings.layoutMode = e.target.value;
                saveSettings();
                renderMainUI();
            });
        }
        const sideRailExportJsonBtn = document.getElementById('sideRailExportJsonBtn');
        if (sideRailExportJsonBtn) {
            sideRailExportJsonBtn.addEventListener('click', function() {
                handleExportJson();
            });
        }
        const sideRailExportTxtBtn = document.getElementById('sideRailExportTxtBtn');
        if (sideRailExportTxtBtn) {
            sideRailExportTxtBtn.addEventListener('click', function() {
                handleExportTxt();
            });
        }
        const sideRailImportDataBtn = document.getElementById('sideRailImportDataBtn');
        if (sideRailImportDataBtn) {
            sideRailImportDataBtn.addEventListener('click', function() {
                handleImportData();
            });
        }
        const sideRailResetAllDataBtn = document.getElementById('sideRailResetAllDataBtn');
        if (sideRailResetAllDataBtn) {
            sideRailResetAllDataBtn.addEventListener('click', function() {
                if(confirm(t('confirmReset'))) {
                    targets = [];
                    transactions = [];
                    saveTargets();
                    saveTransactions();
                    renderMainUI();
                    showToast(t('resetDone'));
                }
            });
        }
        
        const sidebarCurrencySel = document.getElementById('sidebarCurrencySelect');
        if (sidebarCurrencySel) {
            sidebarCurrencySel.value = settings.currency || 'IDR';
            sidebarCurrencySel.onchange = function (e) {
                settings.currency = e.target.value;
                saveSettings();
                // Debounce renderMainUI for performance
                if (currencyChangeTimeout) clearTimeout(currencyChangeTimeout);
                currencyChangeTimeout = setTimeout(() => renderMainUI(), 100);
            };
        }
        const sidebarLangSel = document.getElementById('sidebarLangSelect');
        if (sidebarLangSel) {
            sidebarLangSel.value = currentLang;
            sidebarLangSel.onchange = function (e) { applyLanguage(e.target.value); };
        }
        const darkModeToggle = document.getElementById('sidebarDarkModeToggle');
        if (darkModeToggle) {
            darkModeToggle.value = settings.theme || 'dark';
            darkModeToggle.onchange = function (e) { settings.theme = e.target.value; saveSettings(); applyTheme(); };
        }
        const resetBtn = document.getElementById('resetAllDataBtn');
        if (resetBtn) {
            resetBtn.onclick = function () {
                if (confirm(t('confirmReset'))) {
                    targets = [];
                    transactions = [];
                    saveTargets();
                    saveTransactions();
                    renderMainUI();
                    showToast(t('resetDone'));
                }
            };
        }
        document.getElementById('logoutBtn').onclick = () => { logout(); };
        
        // Hamburger menu event listener
        const hamburger = document.getElementById('hamburgerMenu');
        if (hamburger) {
            hamburger.addEventListener('click', toggleSidebar);
        }
    }

    // ======================= LOGIN / LOGOUT =======================
    function setLoggedIn(user) {
        currentUser = user;
        saveUser();
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';
        loadData();
        renderMainUI();
        attachSidebarEvents();
    }
    function logout() {
        closeSidebar();
        syncVaultFromMemory();
        setAuthBusy(false);
        currentUser = null;
        saveUser();
        document.getElementById('main-app').style.display = 'none';
        document.getElementById('auth-container').style.display = 'flex';
        targets = [];
        transactions = [];
        document.getElementById('authPanelLogin').style.display = 'block';
        document.getElementById('authPanelRegister').style.display = 'none';
        const le = document.getElementById('loginEmail');
        const lp = document.getElementById('loginPass');
        if (le) le.value = '';
        if (lp) lp.value = '';
        setAuthError('loginError', '');
        setAuthError('registerError', '');
        renderMainUI();
        restartTyping();
    }

    function showLoginPanel() {
        document.getElementById('authPanelLogin').style.display = 'block';
        document.getElementById('authPanelRegister').style.display = 'none';
        setAuthError('registerError', '');
    }
    function showRegisterPanel() {
        document.getElementById('authPanelLogin').style.display = 'none';
        document.getElementById('authPanelRegister').style.display = 'block';
        setAuthError('loginError', '');
        const cb = document.getElementById('agreeTerms');
        if (cb) cb.checked = false;
        updateRegisterSubmitEnabled();
    }

    // ======================= INFINITY ANIMATION & INIT =======================
    let lemniscateAnimationId = null;
    let lemniscateParticles = [];

    function initLemniscateAnimation() {
        const SVG_NS = 'http://www.w3.org/2000/svg';
        const config = {
            particleCount: 50,
            trailSpan: 0.25,
            durationMs: 3000,
            pulseDurationMs: 2400,
            strokeWidth: 4.2,
            lemniscateA: 26,
            lemniscateBoost: 7
        };

        const group = document.getElementById('lemniscateGroup');
        const path = document.getElementById('lemniscatePath');
        if (!group || !path) return;

        path.setAttribute('stroke-width', String(config.strokeWidth));

        // Create particles
        lemniscateParticles = Array.from({ length: config.particleCount }, () => {
            const circle = document.createElementNS(SVG_NS, 'circle');
            circle.setAttribute('fill', 'currentColor');
            group.appendChild(circle);
            return circle;
        });

        function normalizeProgress(progress) {
            return ((progress % 1) + 1) % 1;
        }

        function getDetailScale(time) {
            const pulseProgress = (time % config.pulseDurationMs) / config.pulseDurationMs;
            const pulseAngle = pulseProgress * Math.PI * 2;
            return 0.52 + ((Math.sin(pulseAngle + 0.55) + 1) / 2) * 0.48;
        }

        function point(progress, detailScale) {
            const t = progress * Math.PI * 2;
            const scale = config.lemniscateA + detailScale * config.lemniscateBoost;
            const denom = 1 + Math.sin(t) ** 2;
            return {
                x: 50 + (scale * Math.cos(t)) / denom,
                y: 50 + (scale * Math.sin(t) * Math.cos(t)) / denom,
            };
        }

        function buildPath(detailScale, steps = 480) {
            return Array.from({ length: steps + 1 }, (_, index) => {
                const p = point(index / steps, detailScale);
                return `${index === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
            }).join(' ');
        }

        function getParticle(index, progress, detailScale) {
            const tailOffset = index / (config.particleCount - 1);
            const p = point(normalizeProgress(progress - tailOffset * config.trailSpan), detailScale);
            const fade = Math.pow(1 - tailOffset, 0.56);
            return {
                x: p.x,
                y: p.y,
                radius: 0.9 + fade * 2.7,
                opacity: 0.04 + fade * 0.96,
            };
        }

        const startedAt = performance.now();

        function render(now) {
            const time = now - startedAt;
            const progress = (time % config.durationMs) / config.durationMs;
            const detailScale = getDetailScale(time);
            path.setAttribute('d', buildPath(detailScale));
            lemniscateParticles.forEach((node, index) => {
                const particle = getParticle(index, progress, detailScale);
                node.setAttribute('cx', particle.x.toFixed(2));
                node.setAttribute('cy', particle.y.toFixed(2));
                node.setAttribute('r', particle.radius.toFixed(2));
                node.setAttribute('opacity', particle.opacity.toFixed(3));
            });
            lemniscateAnimationId = requestAnimationFrame(render);
        }

        lemniscateAnimationId = requestAnimationFrame(render);
    }

    function stopLemniscateAnimation() {
        if (lemniscateAnimationId) {
            cancelAnimationFrame(lemniscateAnimationId);
            lemniscateAnimationId = null;
        }
        // Remove particles
        lemniscateParticles.forEach(p => p.remove());
        lemniscateParticles = [];
    }

    function initInfinityAnimation() {
        initLemniscateAnimation();
    }
    
    // Updated hideLoading with lemniscate animation cleanup
    function hideLoading() {
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.style.opacity = '0';
            setTimeout(() => {
                loadingScreen.style.display = 'none';
                stopLemniscateAnimation();
                if(currentUser) {
                    document.getElementById('auth-container').style.display = 'none';
                    document.getElementById('main-app').style.display = 'block';
                    renderMainUI();
                    attachSidebarEvents();
                } else {
                    document.getElementById('auth-container').style.display = 'flex';
                    typeEffect();
                }
            }, 500);
        }
        
        // Stop infinity canvas animation to free resources
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        
        // Clear canvas context
        const canvas = document.getElementById('infinityCanvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    // ======================= EVENT LISTENER LOGIN =======================
    document.getElementById('btnLogin').onclick = handleLogin;
    document.getElementById('btnShowRegister').onclick = function () { showRegisterPanel(); };
    document.getElementById('btnBackToLogin').onclick = function () { showLoginPanel(); };
    document.getElementById('btnRegisterSubmit').onclick = async function () {
        const username = sanitizeTextInput(document.getElementById('regUsername').value, 64);
        const email = sanitizeEmailInput(document.getElementById('regEmail').value);
        const pass = document.getElementById('regPass').value;
        const conf = document.getElementById('regConfirm').value;
        setAuthError('registerError', '');
        const cb = document.getElementById('agreeTerms');
        if (cb && !cb.checked) {
            setAuthError('registerError', t('errAgreeRequired'));
            updateRegisterSubmitEnabled();
            return;
        }

        if (!username) {
            setAuthError('registerError', t('errUserRequired'));
            return;
        }
        if (!email) {
            setAuthError('registerError', t('errEmailRequired'));
            return;
        }
        if (!emailHasAtValid(email)) {
            setAuthError('registerError', t('errEmailInvalid'));
            return;
        }
        if (!pass) {
            setAuthError('registerError', t('errPassRequired'));
            return;
        }
        if (pass.length < MIN_PASS_LEN) {
            setAuthError('registerError', t('errPassShort'));
            return;
        }
        if (!validatePasswordStrength(pass)) {
            setAuthError('registerError', 'Password must contain at least one letter and one digit');
            return;
        }
        if (pass !== conf) {
            setAuthError('registerError', t('errPassMismatch'));
            return;
        }

        const accounts = loadAccounts();
        const taken = accounts.some(function (a) {
            return String(a.email).trim().toLowerCase() === email.toLowerCase();
        });
        if (taken) {
            setAuthError('registerError', t('errEmailTaken'));
            return;
        }

        if (!ensureBcryptLoaded()) {
            setAuthError('registerError', t('errCrypto'));
            return;
        }

        setAuthBusy(true, 'cryptoEncrypting');
        try {
            const hash = await bcryptHashAsync(pass);
            accounts.push({ username: username, email: email, password: hash });
            saveAccounts(accounts);
            document.getElementById('regUsername').value = '';
            document.getElementById('regEmail').value = '';
            document.getElementById('regPass').value = '';
            document.getElementById('regConfirm').value = '';
            if (cb) cb.checked = false;
            updateRegisterSubmitEnabled();
            setLoggedIn({ name: username, email: email, isGuest: false });
        } catch (e) {
            setAuthError('registerError', t('errCrypto'));
        } finally {
            setAuthBusy(false);
        }
    };
    document.getElementById('btnGuest').onclick = function () {
        setLoggedIn({ name: t('guestName'), email: 'guest@local', isGuest: true });
    };

    document.getElementById('loginEmail').addEventListener('input', function () {
        if (getLoginLockRemainingSec() > 0) updateLoginCooldownUI();
        else setAuthError('loginError', '');
    });
    document.getElementById('loginEmail').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') handleLogin();
    });
    document.getElementById('loginPass').addEventListener('input', function () {
        if (getLoginLockRemainingSec() > 0) updateLoginCooldownUI();
        else setAuthError('loginError', '');
    });
    ['regUsername', 'regEmail', 'regPass', 'regConfirm'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', function () { setAuthError('registerError', ''); });
    });
    const agreeCb = document.getElementById('agreeTerms');
    if (agreeCb) agreeCb.addEventListener('change', function () {
        setAuthError('registerError', '');
        updateRegisterSubmitEnabled();
    });
    document.getElementById('regConfirm').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') document.getElementById('btnRegisterSubmit').click();
    });
    document.getElementById('loginPass').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') handleLogin();
    });

    document.getElementById('langSelect').addEventListener('change', function (e) {
        applyLanguage(e.target.value);
    });

    document.getElementById('loginThemeSelect').addEventListener('change', function (e) {
        settings.theme = e.target.value;
        saveSettings();
        applyTheme();
    });

    document.getElementById('linkLegalTos').onclick = function () { openLegalModal('tos'); };
    document.getElementById('linkLegalPrivacy').onclick = function () { openLegalModal('privacy'); };
    document.getElementById('linkLegalHelp').onclick = function () { openLegalModal('help'); };

    // FAIL-SAFE INITIALIZATION: Wrap everything in try-catch-finally
    // This ensures loading screen ALWAYS hides even if errors occur
    window.addEventListener('DOMContentLoaded', function() {
        try {
            initInfinityAnimation();
            loadData();
            applyLanguage(currentLang);
            updateRegisterSubmitEnabled();
        } catch (err) {
            console.error("Critical Init Error:", err);
        } finally {
            // Essential: Hide loader even if errors occur
            setTimeout(hideLoading, 500);
        }
    });
