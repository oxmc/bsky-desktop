const fs = require('fs');
const path = require('path');
const { session } = require('electron');
const AdmZip = require('adm-zip');

/**
 * Unpacks a .crx file and loads it as an Electron extension.
 * @param {string} crxPath - Path to the .crx file.
 * @returns {Promise<string>} - Resolves with the extension ID after loading.
 */
async function loadCRX(crxPath) {
    const outputDir = path.join(__dirname, 'extensions', path.basename(crxPath, '.crx'));

    // Ensure the output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });

        // Extract the .crx file
        const crxData = fs.readFileSync(crxPath);
        const crxHeaderSize = crxData.readUInt32LE(8); // Extract header size from CRX
        const zipData = crxData.slice(crxHeaderSize);

        // Save the ZIP content
        const zip = new AdmZip(zipData);
        zip.extractAllTo(outputDir, true);
    }

    // Load the unpacked extension into Electron
    try {
        const { id } = await session.defaultSession.loadExtension(outputDir);
        console.log(`Extension loaded with ID: ${id}`);
        return id;
    } catch (error) {
        console.error('Failed to load extension:', error);
        throw error;
    }
}

module.exports = loadCRX;