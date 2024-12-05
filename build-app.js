const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs/promises');
const process = require('process');
const packageJson = require('./package.json');

// Electron builder:
const electronBuilderPath = path.join('node_modules', 'electron-builder', 'cli.js');

// Parse command-line arguments:
const supportedPlatforms = ['win', 'mac', 'linux', 'mwl'];
const supportedArchitectures = ['x64', 'armv7l', 'arm64', 'ia32', 'universal'];
const args = process.argv.slice(2);
const carch = args.includes('--arch') ? args[args.indexOf('--arch') + 1] : null;
const cplatform = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : null;
const pack = args.includes('--pack') || null;

let platform, arch, build_args;

//console.log(supportedPlatforms, supportedArchitectures, cplatform, carch);

// Platform Name:
if (cplatform == null) {
    switch (process.platform) {
        case "win32":
            platform = "win";
            break;
        case "darwin":
            platform = "mac";
            break;
        case "linux":
            platform = "linux";
            break;
        default:
            platform = "mwl"; // Build for all
            break;
    }
} else {
    if (!supportedPlatforms.includes(cplatform)) {
        console.error(`Invalid platform specified. Supported platforms: ${supportedPlatforms.join(', ')}`);
        process.exit(1);
    }
    platform = cplatform;
}

// Platform Arch:
if (carch == null) {
    arch = process.arch === "arm" ? "armv7l" : process.arch;
} else {
    arch = carch;
    if (!supportedArchitectures.includes(arch)) {
        console.error(`Invalid arch specified. Supported architectures: ${supportedArchitectures.join(', ')}`);
        process.exit(1);
    }
}

// Generate artifact name:
const artifactname = `${packageJson.build.productName}-${packageJson.version}-${platform}-${arch}`;

(async () => {
    try {
        // Additional build arguments: (started wiht --eb-nmehere)
        const additionalArgs = args.filter((arg, index) => arg.startsWith('--eb-') && index % 2 !== 0);

        // CLI Args:
        build_args = [
            electronBuilderPath,
            `--${platform}`,
            `--${arch}`,
            `-c.artifactName="${artifactname}.\${ext}"`,
        ];

        // If additional args are present:
        if (additionalArgs.length > 0) {
            build_args.push(...additionalArgs);
        }

        // If pack is true:
        if (pack) {
            build_args.push(`--dir`);
        }

        // Make CLI:
        const cli = `node ${build_args.join(' ')}`;

        console.info(`CLI: ${cli}`);
        console.info(`Building ${artifactname}`);
        const process = spawn(cli, { shell: true });

        // Log stdout as it comes
        process.stdout.on('data', (data) => {
            console.log(data.toString().trim());
        });

        // Log stderr as it comes
        process.stderr.on('data', (data) => {
            console.error(data.toString().trim());
        });

        // Handle process exit
        process.on('close', (code) => {
            if (code === 0) {
                console.info(`Build completed successfully!`);
            } else {
                console.error(`Process exited with code ${code}`);
            }
        });

        process.on('error', (error) => {
            console.error(`Failed to start process: ${error.message}`);
        });
    } catch (error) {
        console.error('An error occurred:', error);
        process.exit(1);
    }
})();