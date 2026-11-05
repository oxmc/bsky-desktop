export interface LicenseEntry {
    type: string;
    url: string;
}

export interface PackageJson {
    productName?: string;
    description?: string;
    homepage?: string;
    license?: string | LicenseEntry;
    bugs?: {
        url: string;
    };
}

export interface AboutWindowInfo {
    icon_path: string;
    product_name?: string;
    copyright?: string;
    homepage?: string;
    description?: string;
    package_json_dir?: string;
    about_page_dir?: string;
    license?: string;
    bug_report_url?: string;
    css_path?: string | string[];
    adjust_window_size?: boolean;
    win_options?: Electron.BrowserWindowConstructorOptions;
    open_devtools?: boolean;
    use_inner_html?: boolean;
    bug_link_text?: string;
    use_version_info?: boolean | [string, string][];
    show_close_button?: string;
    app?: Electron.App;
    BrowserWindow?: typeof Electron.BrowserWindow;
    ipcMain?: Electron.IpcMain;
}

/**
 * Initializes (but does not show) the about window.
 * Must be called before `openAboutWindow`.
 */
export function initAboutWindow(info_or_img_path: AboutWindowInfo | string): void;

/**
 * Displays the previously-initialized about window.
 * Throws if the window hasn't been initialized.
 */
export function openAboutWindow(): Electron.BrowserWindow;