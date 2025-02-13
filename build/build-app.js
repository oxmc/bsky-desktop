const path = require('path');
const process = require('process');
const builder = require('electron-builder');
const { Platform, Arch } = builder;

// Parse command-line arguments
const supportedPlatforms = ['win', 'mac', 'linux'];
const supportedArchitectures = ['x64', 'armv7l', 'arm64', 'ia32', 'universal'];
const args = process.argv.slice(2);
const carch = args.includes('--arch') ? args[args.indexOf('--arch') + 1] : null;
const cplatform = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : null;
const pack = args.includes('--pack');  // Keep track of --pack as a boolean flag
const nobc = args.includes('--no-bc');  // Keep track of --nobc as a boolean flag

// Determine platform
let platform;
if (!cplatform) {
    platform = process.platform === 'win32' ? 'win' :
        process.platform === 'darwin' ? 'mac' :
            process.platform === 'linux' ? 'linux' : null;
} else if (!supportedPlatforms.includes(cplatform)) {
    console.error(`Invalid platform specified. Supported platforms: ${supportedPlatforms.join(', ')}`);
    process.exit(1);
} else {
    platform = cplatform;
}

// Determine architecture
let arch = carch || (process.arch === 'arm' ? 'armv7l' : process.arch);
if (!supportedArchitectures.includes(arch)) {
    console.error(`Invalid architecture specified. Supported architectures: ${supportedArchitectures.join(', ')}`);
    process.exit(1);
}

// Map platform and architecture to electron-builder enums
const platformEnum = {
    win: Platform.WINDOWS,
    mac: Platform.MAC,
    linux: Platform.LINUX
}[platform];

const archEnum = {
    x64: Arch.x64,
    armv7l: Arch.armv7l,
    arm64: Arch.arm64,
    ia32: Arch.ia32,
    universal: Arch.universal
}[arch];

// Additional build arguments: (starting with --eb-)
const buildArgs = args.filter((arg) => arg.startsWith('--eb-'));

// If additional args are present, add them to the buildArgs array
if (buildArgs.length > 0) {
    console.log('Additional build arguments:', buildArgs);
}

// If pack is true, add --dir to buildArgs
if (pack) {
    buildArgs.push('--dir');
}

// Default build configuration (used when --no-bc is passed) [Default values are for bskyDesktop]
const defaultBuildConfig = {
    "appId": "com.oxmc.bskyDesktop",
    "productName": "bskyDesktop",
    "asarUnpack": [
        "./node_modules/node-notifier/**/*"
    ],
    "win": {
        "icon": "src/ui/images/logo.ico",
    },
    "mac": {
        "icon": "src/ui/images/mac.icns",
    },
    "linux": {
        "icon": "src/ui/images/icons",
    },
};

// Read build-config.json if it exists and --no-bc is not present
const buildConfigPath = path.join(__dirname, 'build-config.json');
let buildConfig = defaultBuildConfig;
if (!nobc) {
    if (!require('fs').existsSync(buildConfigPath)) {
        console.error('build-config.json not found');
        process.exit(1);
    }
    try {
        buildConfig = require(buildConfigPath);
    } catch (err) {
        console.error(`Failed to read build-config.json: ${err.message}`);
        process.exit(1);
    }
}

// Generate artifact name
const packageJson = require('../package.json');
const artifactName = `${buildConfig.productName}-${packageJson.version}-${platform}-${arch}.\${ext}`;

// Electron Builder configuration
/**
 * @type {import('electron-builder').Configuration}
 */
const options = {
    artifactName,
    nsis: {
        deleteAppDataOnUninstall: true,
        oneClick: true,
        perMachine: false
    },
    /*dmg: {
        contents: [
            { type: 'file', x: 255, y: 85 },
            { type: 'link', path: '/Applications', x: 253, y: 325 }
        ]
    },*/
    ...buildConfig
};

// Build process
builder.build({
    targets: platformEnum.createTarget(null, archEnum),
    config: options
}).then(result => {
    console.log("Build completed:", JSON.stringify(result, null, 2));
}).catch(error => {
    console.error("Build failed:", error);
});