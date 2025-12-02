/*
 Updated by Seth Olivarez <oxmc7769.mail@gmail.com> (2025).
*/

/*
 By Tomas Pollak <tomas@forkhq.com> (2017).
 MIT License.
*/

var join = require('path').join,
    spawn = require('child_process').spawn;

var Dialog = module.exports = {

    err: function (str, title, callback) {
        this.show('error', str, title, callback);
    },

    info: function (str, title, callback) {
        this.show('info', str, title, callback);
    },

    warn: function (str, title, callback) {
        this.show('warning', str, title, callback);
    },

    /**
     * Shows a simple alert/info/warning dialog.
     * @param {string} type - 'info', 'warning', or 'error'.
     * @param {string} str - The message string.
     * @param {string} [title] - The dialog title.
     * @param {function} [callback] - Optional callback(code, stdout, stderr) called when the dialog is closed.
     */
    show: function (type, str, title, callback) {
        if (!str || str.trim() == '')
            throw new Error('Empty or no string passed!');

        if (typeof title == 'function') {
            callback = title;
            title = null;
        }

        var cmd = [],
            os_name = process.platform,
            title = title ? title : 'Important';

        var str = (str + '').replace(/([.?*+^$[\]\\(){}<>|`-])/g, "\$1");

        // return codes for zenity are 0 on "OK"
        // and 1 on "No/Cancel" or close window
        if (os_name == 'linux') {
            str = str.replace(/[<>]/g, ''); // Zenity might interpret these? Original code did this.
            cmd.push('zenity');
            cmd.push('--' + type); // --info, --warning, --error
            cmd.push('--text') && cmd.push(str);
            cmd.push('--title') && cmd.push(title);
            if (str.length > 30) cmd.push('--width') && cmd.push('300');

            // return codes in macOS for display dialog with "OK" button: 0 for 'OK', 1 if dismissed via close button/escape (might need verification, osascript exit code itself usually 0 on success)
        } else if (os_name == 'darwin') {

            var iconType; // Map type to osascript icon type
            switch (type) {
                case 'error':
                    iconType = 'stop'; // or 0
                    break;
                case 'info':
                    iconType = 'note'; // or 1
                    break;
                case 'warning':
                    iconType = 'caution'; // or 2
                    break;
                default:
                    iconType = ''; // No specific icon
            }

            str = str.replace(/"/g, '"\'"&"\'"'); // Escape double quotes for osascript string
            title = title.replace(/"/g, '"\'"&"\'"'); // Escape double quotes for osascript string

            // The AppleScript for a simple OK dialog
            var script = `tell application "System Events" to display dialog "${str}" with title "${title}" buttons {"OK"}`;
            if (iconType) {
                script += ` with icon ${iconType}`;
            }
            // Add 'default button' for accessibility, though only one button here
            script += ` default button "OK"`;


            cmd.push('osascript') && cmd.push('-e');
            cmd.push(script);

        } else { // windows - Assumes msgbox.vbs takes (message, type, title) where type is VBScript button+icon constant

            var msgBoxType; // VBScript MsgBox button + icon type
            switch (type) {
                case 'error':
                    msgBoxType = 16; // vbCritical icon
                    break;
                case 'info':
                    msgBoxType = 64; // vbInformation icon
                    break;
                case 'warning':
                    msgBoxType = 48; // vbExclamation icon
                    break;
                default:
                    msgBoxType = 0; // vbOKOnly buttons, vbNoIcon
            }

            str = str.replace(/"/g, '""'); // Escape double quotes for VBScript string literal
            title = title.replace(/"/g, '""'); // Escape double quotes for VBScript string literal

            // Assuming msgbox.vbs accepts message, type (vb constants), and title
            cmd.push('cscript');
            cmd.push('//Nologo'); // Don't display logo
            cmd.push(join(__dirname, 'msgbox.vbs'));
            cmd.push('"' + str + '"'); // Message as first argument
            cmd.push(msgBoxType);   // Type as second argument
            cmd.push('"' + title + '"'); // Title as third argument

        }

        // Use the run method, passing the callback
        this.run(cmd, callback);
    },

    /**
     * Shows a question dialog with Yes and No buttons.
     * The callback receives buttonIndex (0 for Yes, 1 for No/Cancel/Close).
     * @param {string} str - The message string.
     * @param {string} [title] - The dialog title.
     * @param {function} callback - Callback(buttonIndex, stdout, stderr) called when the dialog is closed. buttonIndex is 0 for Yes, 1 for No/Cancel.
     */
    question: function (str, title, callback) {
        if (!str || str.trim() == '') {
            // Call callback with error or throw? Let's throw for consistency with show.
            throw new Error('Empty or no string passed!');
        }

        if (typeof title === 'function') {
            callback = title;
            title = null;
        }

        if (typeof callback !== 'function') {
            // A callback is required to get the button result
            throw new Error('Callback function is required for question dialog.');
        }


        var cmd = [],
            os_name = process.platform,
            title = title ? title : 'Question'; // Default title for question

        // String escaping is different for each OS command
        var escapedStr;
        var escapedTitle;


        if (os_name == 'linux') {
            // Zenity escaping: Basic characters are usually fine, but <> might be interpreted. Original code removed them.
            escapedStr = (str + '').replace(/[<>]/g, '');
            escapedTitle = (title + '').replace(/[<>]/g, ''); // Apply same escaping to title

            cmd.push('zenity');
            cmd.push('--question'); // Use the question type
            cmd.push('--text') && cmd.push(escapedStr);
            cmd.push('--title') && cmd.push(escapedTitle);
            // Zenity question has Yes/No by default. 0 for Yes, 1 for No/Cancel/Close.
            // Optional: customize buttons if needed, but default Yes/No works.
            // cmd.push('--ok-label=Yes'); cmd.push('--cancel-label=No');

        } else if (os_name == 'darwin') {
            // osascript escaping: double quotes need to be escaped carefully
            // A common way is '"\'"&"\'"' which breaks out of the string, adds a literal ', adds the original quote, adds another literal ', then rejoins the string.
            // Or simpler: replace " with \" if the string is within double quotes. Let's try that.
            // If string is 'abc"def', becomes 'abc\"def'. Needs to be within "..." in the script.
            escapedStr = (str + '').replace(/"/g, '\\"').replace(/\n/g, '\\n'); // Escape quotes and newlines
            escapedTitle = (title + '').replace(/"/g, '\\"').replace(/\n/g, '\\n'); // Escape quotes and newlines


            cmd.push('osascript') && cmd.push('-e');
            // AppleScript to display a dialog with Yes and No buttons.
            // We specify buttons {"No", "Yes"} and default button "Yes" to match Electron's common pattern (Yes is the default and returns 0).
            // The icon type 2 is 'caution', often used for questions.
            // The 'display dialog' command returns a record like {button returned:"Yes", gave up:false}.
            // We add another -e command to return the 'button returned' property to stdout.
            var script = `tell application "System Events" to display dialog "${escapedStr}" with title "${escapedTitle}" buttons {"No", "Yes"} default button "Yes" with icon caution`; // Use 'caution' or 2

            cmd.push(script);
            cmd.push('-e'); // Add another -e argument
            cmd.push('return button returned of result'); // Command to print the button result to stdout


        } else { // windows - Assumes msgbox.vbs takes (message, type, title)

            // VBScript escaping: double quotes need to be doubled
            escapedStr = (str + '').replace(/"/g, '""');
            escapedTitle = (title + '').replace(/"/g, '""');

            // VBScript MsgBox button types: vbYesNo = 4
            // VBScript MsgBox return values: vbYes = 6, vbNo = 7
            // We need the VBScript to return 6 on Yes, 7 on No as the exit code.
            // Assuming msgbox.vbs can accept message, type (vb constant), title
            var msgBoxType = 4; // vbYesNo buttons

            cmd.push('cscript');
            cmd.push('//Nologo'); // Don't display logo
            cmd.push(join(__dirname, 'msgbox.vbs'));
            cmd.push('"' + escapedStr + '"'); // Message as first argument
            cmd.push(msgBoxType);   // Button type as second argument (4 for Yes/No)
            cmd.push('"' + escapedTitle + '"'); // Title as third argument

        }

        // Use the run method, and process the result before calling the user's callback
        this.run(cmd, (code, stdout, stderr) => {
            let buttonIndex;

            if (os_name === 'linux') {
                // Zenity returns 0 for Yes, 1 for No/Cancel/Close
                buttonIndex = (code === 0) ? 0 : 1;
            } else if (os_name === 'darwin') {
                // osascript returns "Yes" or "No" in stdout
                const result = stdout.trim();
                if (result === 'Yes') {
                    buttonIndex = 0; // Map Yes to 0
                } else {
                    buttonIndex = 1; // Map No or anything else (like being dismissed) to 1
                }
            } else { // windows
                // Assuming msgbox.vbs returns 6 for Yes, 7 for No as the exit code
                if (code === 6) {
                    buttonIndex = 0; // Map vbYes (6) to 0
                } else {
                    // Map vbNo (7) or any other exit code to 1
                    buttonIndex = 1; // Map vbNo (7) or anything else to 1
                }
            }

            // Call the user's original callback with the standardized button index
            callback(buttonIndex, stdout, stderr);
        });
    },


    run: function (cmd, cb) {
        var bin = cmd[0],
            args = cmd.slice(1), // Use slice(1) to keep cmd array intact for logging/debugging if needed
            stdout = '',
            stderr = '';

        //console.log('Running command:', bin, args.join(' ')); // Optional: for debugging

        var child = spawn(bin, args, {
            detached: true,
            // Ensure stdio is piped so we can capture stdout/stderr
            // 'ignore' for stdin, 'pipe' for stdout/stderr
            stdio: ['ignore', 'pipe', 'pipe']
        });

        child.stdout.on('data', function (data) {
            stdout += data.toString();
        })

        child.stderr.on('data', function (data) {
            stderr += data.toString();
        })

        child.on('error', function (err) {
            // Handle potential errors like command not found
            console.error('Failed to start dialog process:', err);
            // Call the callback with an error code (e.g., 1) and the error object
            cb && cb(1, stdout, stderr + '\nFailed to start dialog process: ' + err.message);
        });

        child.on('exit', function (code, signal) {
            // Pass exit code, stdout, stderr to the specific dialog method's callback
            cb && cb(code, stdout, stderr);
        })

        // Unreference the child process so the parent can exit independently
        child.unref();
    }

}