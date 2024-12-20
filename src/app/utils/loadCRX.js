const fs = require('fs');
const path = require('path');
const { session } = require('electron');
const AdmZip = require('adm-zip');

/**
 * Converts a CRX file buffer to a ZIP buffer.
 * @param {Buffer} buf - The CRX file buffer.
 * @returns {Buffer} - The ZIP buffer extracted from the CRX file.
 */
function crxToZip(buf) {
    function calcLength(a, b, c, d) {
        let length = 0;
        length += a << 0;
        length += b << 8;
        length += c << 16;
        length += (d << 24) >>> 0;
        return length;
    }

    // Check if the file is already a ZIP file
    if (buf[0] === 80 && buf[1] === 75 && buf[2] === 3 && buf[3] === 4) {
        return buf;
    }

    // Validate CRX magic number
    if (buf[0] !== 67 || buf[1] !== 114 || buf[2] !== 50 || buf[3] !== 52) {
        throw new Error('Invalid CRX file: Missing Cr24 magic number');
    }

    const version = buf[4];
    const isV2 = version === 2;
    const isV3 = version === 3;

    if ((!isV2 && !isV3) || buf[5] || buf[6] || buf[7]) {
        throw new Error('Unsupported CRX format version.');
    }

    if (isV2) {
        const publicKeyLength = calcLength(buf[8], buf[9], buf[10], buf[11]);
        const signatureLength = calcLength(buf[12], buf[13], buf[14], buf[15]);
        const zipStartOffset = 16 + publicKeyLength + signatureLength;
        return buf.slice(zipStartOffset);
    }

    const headerSize = calcLength(buf[8], buf[9], buf[10], buf[11]);
    const zipStartOffset = 12 + headerSize;
    return buf.slice(zipStartOffset);
}

/**
 * Unpacks a .crx file and loads it as an Electron extension.
 * @param {string} crxPath - Path to the .crx file.
 * @returns {Promise<string>} - Resolves with the extension ID after loading.
 */
async function loadCRX(crxPath) {
    const outputDir = path.join(global.paths.extensions, path.basename(crxPath, '.crx'));

    // Ensure the output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });

        // Read the CRX file
        const crxData = fs.readFileSync(crxPath);

        // Convert CRX to ZIP
        const zipData = crxToZip(crxData);

        // Extract ZIP using AdmZip
        const zip = new AdmZip(zipData);
        zip.getEntries().forEach((entry) => {
            const fullPath = path.join(outputDir, entry.entryName);

            if (entry.isDirectory) {
                fs.mkdirSync(fullPath, { recursive: true });
            } else {
                fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                fs.writeFileSync(fullPath, entry.getData());
            }
        });
    }

    // Load the unpacked extension into Electron
    try {
        // Check for manifest.json
        const manifestPath = path.join(outputDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            throw new Error('Extension is missing manifest.json');
        };
        // Load the extension
        const { id } = await session.defaultSession.loadExtension(outputDir);
        console.log(`Extension loaded with ID: ${id}`);
        return id;
    } catch (error) {
        console.error('Failed to load extension:', error);
        throw error;
    }
}

module.exports = loadCRX;