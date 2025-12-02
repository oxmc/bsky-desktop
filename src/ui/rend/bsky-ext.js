console.log("BLUESKY EXTENSION LOADED");
const BskyExt = {
    emoji: {
        /**
     * @method parseEmojis
     * @description Formats the emojis to use the external emojis
     * 
     * @param {element | string} element		- The element or string to format the emojis in
     * 
     * @return {element | string} result		- The formatted element or string matching the type of the element passed in
     * 
     * @since 0.0.2
     */
        parseEmojis(element) {
            let type = typeof element;
            // Create a temporary div element to push the element into if a string was passed in
            if (typeof element === "string") {
                let x = document.createElement("div");
                x.innerHTML = element;
                element = x;
            }

            // Parse the emojis in the element if it has unicode emojis and isn't already parsed
            if (this.hasUnicodeEmoji(element) && !this.hasTwemoji(element)) {
                twemoji.parse(element);
            }

            // Return the element or string
            if (type === "string") {
                return element.innerHTML;
            }

            return element;
        },
        /**
     * @method parseInChildren
     * @description Parses the emojis in the element's children
     * 
     * @param {element} element		- The element to parse the emojis in
     * @param {object} args			- The arguments for the function
     * @param {string} args.selector	- The selector for the element's children to parse
     * @param {boolean} args.recursive	- Whether or not to recursively parse the element's children
     * 
     * @since 0.0.2
     */
        parseInChildren(element, args = { selector: false, recursive: false }) {
            // Get the arguments
            let selector = args.selector || false;
            let recursive = args.recursive || false;

            // Get the element's children
            let children = element.children;

            // Check if the element has children
            if (!children || children.length < 1) {
                return false;
            }

            // Loop through the element's children
            for (let i = 0; i < children.length; i++) {
                // Get the child
                let child = children[i];

                // If a selector was passed in. Check if the child doesn't match the selector and return if it doesn't
                if (selector && !child.matches(selector)) {
                    // Check the child's children if recursive is true
                    if (recursive) {
                        this.parseInChildren(child, args);
                    }

                    return;
                }

                // Check if the child has unicode emojis
                if (this.hasUnicodeEmoji(child)) {
                    // Parse the child's emojis
                    this.parseEmojis(child);
                }
            }

            return true;
        },

        /**
         * @method hasUnicodeEmoji
         * @description Checks if the element has (unicode) emojis
         * 
         * @param {element | string} element		- The element or string to check for emojis
         * 
         * @returns {boolean} result	- Whether or not the element has emojis
         * 
         * @since 0.0.2
         */
        hasUnicodeEmoji(element) {
            // Create a temporary div element to push the element into if a string was passed in
            if (typeof element === "string") {
                let x = document.createElement("div");
                x.innerHTML = element;
                element = x;
            }

            // Check if the element has unicode emojis
            if (element.innerText.match(/[\u{1F000}-\u{1FFFF}]/u)) {
                return true;
            }

            return false;
        },

        /**
         * @method hasTwemoji
         * @description Checks if the element has twemojis
         * 
         * @param {element | string} element		- The element or string to check for twemojis
         * 
         * @returns {boolean} result		- Whether or not the element has twemojis
         * 
         * @since 0.0.2
         */
        hasTwemoji(element) {
            // Create a temporary div element to push the element into if a string was passed in
            if (typeof element === "string") {
                let x = document.createElement("div");
                x.innerHTML = element;
                element = x;
            }

            // Check if the element has twemojis
            if (element.querySelector("img.emoji")) {
                return true;
            }

            return false;
        },

        /**
         * @method setCSS
         * @description Sets the CSS for the .emoji class
         * 
         * @since 0.0.2
         */
        setCSS() {
            // Create the CSS string
            let css = `
        img.emoji {
            height: 1.2em;
            line-height: 1em;
            vertical-align: -20%;
        }
    `;
            // Create the style element
            let style = document.createElement("style");
            style.innerHTML = css;
            style.id = "emoji-css";
            style.rel = "text/css";
            style.innerHTML = css;
            // Append the style element to the head
            document.head.appendChild(style);
            return true;
        },
        init() {
            // Array of data-testid values related to pages
            let pageSelectors = [
                "[data-testid='profileView']",
                "[data-testid*='followingFeedPage']",
                "[data-testid='customFeedPage']",
                "[data-testid='notificationsScreen']",
                "[data-testid*='postThreadItem-']",
            ];

            // Create a MutationObserver instance
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const element = node;

                            // Check if the added node matches page selectors or contains a matching child
                            if (
                                (element.dataset && element.dataset.testid && pageSelectors.includes(element.dataset.testid)) ||
                                (element.children && element.querySelector(pageSelectors.join(",")))
                            ) {
                                this.parseInChildren(element, { selector: "[data-testid='postContent']" });
                            }
                        }
                    });

                    // Check for the currently visible page selector
                    pageSelectors.forEach((selector) => {
                        const page = document.querySelector(selector);
                        if (page && page.offsetParent !== null) { // Check if the element is visible
                            this.parseInChildren(page);
                        }
                    });
                });
            });

            // Start observing the document body for changes
            observer.observe(document.body, {
                childList: true,  // Watch for added or removed child nodes
                subtree: true     // Watch all descendant nodes
            });

            // Set the CSS
            this.setCSS();

            // Load the Twemoji script
            let twemojiScript = document.createElement("script");
            twemojiScript.src = "app://ui/lib/twemoji.min.js";
            twemojiScript.onload = () => {
                console.log("Loaded Twemoji script");
            };
            twemojiScript.onerror = (error) => {
                console.error("Failed to load Twemoji script", error);
            };
            document.body.appendChild(twemojiScript);
        }
    },
    profile: {
        parrent: null,
        /**
     * @let {Object} Options - The options for the script, to be overwritten by the user's settings
     * 
     * @since 0.0.1
     */
        options: {
            "formatInline": true,
            "insertButtons": true,
            "showIconsInline": true,
            "showIconsButtons": true,
            "inlineLinkText": 'original',										// original, icon, name, path (the last part of the url)
            "buttonLinkText": 'name',											// original, icon, name
            "inlineLinkTypes": ['messaging', 'content', 'social', 'linkhub'],	// messaging, social, content, linkhub
            "buttonTypes": ['messaging', 'social', 'linkhub'],					// messaging, social, content, linkhub
            "resolveDiscordInvites": true,										// Whether or not to resolve Discord invites to the server name
            "cacheDiscordInvites": true,										// Whether or not to cache Discord invites to the server name to prevent repeated requests
            "bioSelector": "[data-testid='profileHeaderDescription']"			// The selector for the profile bio element
        },

        /**
         * @constant {Object} linkTypes - The link types, icons, and regexes for the supported messaging apps
         * 
         * @since 0.0.1
         */
        linkTypes: {
            "bluesky": {
                "name": "Bluesky",
                "type": "social",
                "icon": "fab fa-bluesky",
                "brand": {
                    "color": "#0085FF",
                },
                "regex": /bsky\.app\/profile\/([a-zA-Z0-9_]+)/
            },
            "discord": {
                "name": "Discord",
                "type": "messaging",
                "icon": "fab fa-discord",
                "brand": {
                    "color": "#7289DA",
                },
                "regex": /discord\.com\/invite\/([a-zA-Z0-9_]+)/
            },
            "discord_profile": {
                "name": "Discord",
                "type": "social",
                "icon": "fab fa-discord",
                "brand": {
                    "color": "#7289DA",
                },
                "regex": /discord\.com\/users\/([a-zA-Z0-9_]+)/
            },
            "discord.gg": {
                "name": "Discord",
                "type": "messaging",
                "icon": "fab fa-discord",
                "brand": {
                    "color": "#7289DA",
                },
                "regex": /discord\.gg\/([a-zA-Z0-9_]+)/
            },
            "telegram": {
                "name": "Telegram",
                "type": "messaging",
                "icon": "fab fa-telegram",
                "brand": {
                    "color": "#0088CC",
                },
                "regex": /t\.me\/([a-zA-Z0-9_]+)/
            },
            "whatsapp": {
                "name": "WhatsApp",
                "type": "messaging",
                "icon": "fab fa-whatsapp",
                "brand": {
                    "color": "#25D366",
                },
                "regex": /wa\.me\/([a-zA-Z0-9_]+)/
            },
            "signal": {
                "name": "Signal",
                "type": "messaging",
                "icon": "fab fa-signal",
                "brand": {
                    "color": "#3b45fd",
                },
                "regex": /signal\.org\/([a-zA-Z0-9_]+)/
            },
            "skype": {
                "name": "Skype",
                "type": "messaging",
                "icon": "fab fa-skype",
                "brand": {
                    "color": "#00AFF0",
                },
                "regex": /skype\.com\/([a-zA-Z0-9_]+)/
            },
            "snapchat": {
                "name": "Snapchat",
                "type": "messaging",
                "icon": "fab fa-snapchat",
                "brand": {
                    "color": "#FFFC00",
                },
                "regex": /snapchat\.com\/add\/([a-zA-Z0-9_]+)/
            },
            "kik": {
                "name": "Kik",
                "type": "messaging",
                "icon": "fab fa-kik",
                "brand": {
                    "color": "#1BBE32",
                },
                "regex": /kik\.me\/([a-zA-Z0-9_]+)/
            },
            "line": {
                "name": "Line",
                "type": "messaging",
                "icon": "fab fa-line",
                "brand": {
                    "color": "#00C300",
                },
                "regex": /line\.me\/([a-zA-Z0-9_]+)/
            },
            "viber": {
                "name": "Viber",
                "type": "messaging",
                "icon": "fab fa-viber",
                "brand": {
                    "color": "#7BB32E",
                },
                "regex": /viber\.com\/([a-zA-Z0-9_]+)/
            },
            "wechat": {
                "name": "WeChat",
                "type": "messaging",
                "icon": "fab fa-weixin",
                "brand": {
                    "color": "#7BB32E",
                },
                "regex": /we\.chat\/([a-zA-Z0-9_]+)/
            },
            "irc": {
                "name": "IRC",
                "type": "messaging",
                "icon": "fas fa-comments",
                "brand": {
                    "color": "#FFFFFF",
                },
                "regex": /irc:\/\/([a-zA-Z0-9_]+)/
            },
            "itchio": {
                "name": "Itch.io",
                "type": "content",
                "icon": "fab fa-itch-io",
                "brand": {
                    "color": "#FA5C5C",
                },
                "regex": /([a-zA-Z0-9_]+)\.itch\.io/
            },
            "etsy_shop": {
                "name": "Etsy",
                "type": "content",
                "icon": "fab fa-etsy",
                "brand": {
                    "color": "#D5641C",
                },
                "regex": /etsy\.com\/shop\/([a-zA-Z0-9_]+)/
            },
            "etsy_user": {
                "name": "Etsy",
                "type": "content",
                "icon": "fab fa-etsy",
                "brand": {
                    "color": "#D5641C",
                },
                "regex": /([a-zA-Z0-9_]+)\.etsy\.com/
            },
            "email": {
                "name": "Email",
                "type": "messaging",
                "icon": "fas fa-envelope",
                "brand": {
                    "color": "#000000",
                },
                "regex": /mailto:([a-zA-Z0-9_]+@[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+)/
            },
            "email_plaintext": {
                "name": "Email",
                "type": "messaging",
                "icon": "fas fa-envelope",
                "brand": {
                    "color": "#000000",
                },
                "regex": /([a-zA-Z0-9_]+@[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+)/
            },
            "twitter": {
                "name": "Twitter",
                "type": "social",
                "icon": "fab fa-twitter",
                "brand": {
                    "color": "#1DA1F2",
                },
                "regex": /(twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/?$/
            },
            "xbox": {
                "name": "Xbox",
                "type": "social",
                "icon": "fab fa-xbox",
                "brand": {
                    "color": "#107C10",
                },
                "regex": /xbox\.com\/([a-zA-Z0-9_]+)/
            },
            "playstation": {
                "name": "PlayStation",
                "type": "social",
                "icon": "fab fa-playstation",
                "brand": {
                    "color": "#003087",
                },
                "regex": /playstation\.com\/([a-zA-Z0-9_]+)/
            },
            "steam": {
                "name": "Steam",
                "type": "content",
                "icon": "fab fa-steam",
                "brand": {
                    "color": "#000000",
                },
                "regex": /steamcommunity\.com\/id\/([a-zA-Z0-9_]+)/
            },
            "tiktok": {
                "name": "TikTok",
                "type": "social",
                "icon": "fab fa-tiktok",
                "brand": {
                    "color": "#000000",
                },
                "regex": /tiktok\.com\/@([a-zA-Z0-9_]+)/
            },
            "instagram": {
                "name": "Instagram",
                "type": "social",
                "icon": "fab fa-instagram",
                "brand": {
                    "color": "#E1306C",
                },
                "regex": /instagram\.com\/([a-zA-Z0-9_]+)/
            },
            "facebook": {
                "name": "Facebook",
                "type": "social",
                "icon": "fab fa-facebook",
                "brand": {
                    "color": "#1877F2",
                },
                "regex": /facebook\.com\/([a-zA-Z0-9_]+)/
            },
            "linkedin": {
                "name": "LinkedIn",
                "type": "social",
                "icon": "fab fa-linkedin",
                "brand": {
                    "color": "#0077B5",
                },
                "regex": /linkedin\.com\/in\/([a-zA-Z0-9_]+)/
            },
            "tumblr": {
                "name": "Tumblr",
                "type": "social",
                "icon": "fab fa-tumblr",
                "brand": {
                    "color": "#36465D",
                },
                "regex": /([a-zA-Z0-9_]+)\.tumblr\.com/
            },
            "twitch": {
                "name": "Twitch",
                "type": "content",
                "icon": "fab fa-twitch",
                "brand": {
                    "color": "#6441A4",
                },
                "regex": /twitch\.tv\/([a-zA-Z0-9_]+)/
            },
            "youtube": {
                "name": "YouTube",
                "type": "content",
                "icon": "fab fa-youtube",
                "brand": {
                    "color": "#FF0000",
                },
                "regex": /^(?:https:\/\/)?(?:www\.)?youtube\.com\/(?:channel|@)([a-zA-Z0-9_-]+)$/
            },
            "github": {
                "name": "GitHub",
                "type": "content",
                "icon": "fab fa-github",
                "brand": {
                    "color": "#333333",
                },
                "regex": /github\.com\/([a-zA-Z0-9_]+)/
            },
            "dribbble": {
                "name": "Dribbble",
                "type": "content",
                "icon": "fab fa-dribbble",
                "brand": {
                    "color": "#EA4C89",
                },
                "regex": /dribbble\.com\/([a-zA-Z0-9_]+)/
            },
            "behance": {
                "name": "Behance",
                "type": "content",
                "icon": "fab fa-behance",
                "brand": {
                    "color": "#1769FF",
                },
                "regex": /behance\.net\/([a-zA-Z0-9_]+)/
            },
            "artstation": {
                "name": "ArtStation",
                "type": "content",
                "icon": "fas fa-palette",
                "brand": {
                    "color": "#13AFF0",
                },
                "regex": /artstation\.com\/([a-zA-Z0-9_]+)/
            },
            "deviantart": {
                "name": "DeviantArt",
                "type": "content",
                "icon": "fab fa-deviantart",
                "brand": {
                    "color": "#05CC47",
                },
                "regex": /([a-zA-Z0-9_]+)\.deviantart\.com/
            },
            "furaffinity": {
                "name": "FurAffinity",
                "type": "content",
                "icon": "fas fa-paw",
                "brand": {
                    "color": "#adacacff",
                },
                "regex": /furaffinity\.net\/user\/([a-zA-Z0-9_]+)/
            },
            "patreon": {
                "name": "Patreon",
                "type": "content",
                "icon": "fab fa-patreon",
                "brand": {
                    "color": "#f96854",
                },
                "regex": /patreon\.com\/([a-zA-Z0-9_]+)/
            },
            "bandcamp": {
                "name": "Bandcamp",
                "type": "content",
                "icon": "fab fa-bandcamp",
                "brand": {
                    "color": "#629aa9",
                },
                "regex": /([a-zA-Z0-9_]+)\/.bandcamp\.com/
            },
            "soundcloud": {
                "name": "SoundCloud",
                "type": "content",
                "icon": "fab fa-soundcloud",
                "brand": {
                    "color": "#ff7700",
                },
                "regex": /soundcloud\.com\/([a-zA-Z0-9_]+)/
            },
            "onlyfans": {
                "name": "OnlyFans",
                "type": "content",
                "icon": "fas fa-fan",
                "brand": {
                    "color": "#00c0fbff",
                },
                "regex": /onlyfans\.com\/([a-zA-Z0-9_]+)/
            },
            "ko-fi": {
                "name": "Ko-fi",
                "type": "content",
                "icon": "fas fa-coffee",
                "brand": {
                    "color": "#f16061",
                },
                "regex": /ko-fi\.com\/([a-zA-Z0-9_]+)/
            },
            "linktree": {
                "name": "Linktree",
                "type": "linkhub",
                "icon": "fas fa-tree",
                "brand": {
                    "color": "#39e09b",
                },
                "regex": /linktr\.ee\/([a-zA-Z0-9_]+)/
            },
            "carrd": {
                "name": "Carrd",
                "type": "linkhub",
                "icon": "fas fa-address-card",
                "brand": {
                    "color": "#2C2F33",
                },
                "regex": /([a-zA-Z0-9_]+\.carrd\.co)/
            },
        },

        /**
         * @constant {Object} linkStyles - The link styles for the supported messaging apps
         * 
         * @since 0.0.1
         */
        linkStyles: {
            "messaging": {
                "default": {
                    "color": "#FFFFFF",
                    "background": "#2C2F33",
                    "border": "#23272A",
                },
                "hover": {
                    "color": "#2C2F33",
                    "background": "#FFFFFF",
                    "border": "#7289DA"
                }
            },
            "social": {
                "default": {
                    "color": "#FFFFFF",
                    "background": "#7289DA",
                    "border": "#7289DA",
                },
                "hover": {
                    "color": "#7289DA",
                    "background": "#FFFFFF",
                    "border": "#7289DA"
                }
            },
            "content": {
                "default": {
                    "color": "#FFFFFF",
                    "background": "#7289DA",
                    "border": "#7289DA",
                },
                "hover": {
                    "color": "#7289DA",
                    "background": "#FFFFFF",
                    "border": "#7289DA"
                }
            },
            "linkhub": {
                "default": {
                    "color": "#FFFFFF",
                    "background": "#7289DA",
                    "border": "#7289DA",
                },
                "hover": {
                    "color": "#7289DA",
                    "background": "#FFFFFF",
                    "border": "#7289DA"
                }
            }
        },

        /**
         * @constant {Object} linkStylesOverrides - Style overrides for specific link types
         */
        linkStylesOverrides: {
            "bluesky": {
                "default": {
                    "color": "rgb(0, 133, 255)",
                    "background": "#0000",
                    "border": "#0000",
                },
                "hover": {
                    "color": "#fff",
                    "background": "#0000",
                    "border": "#0000"
                }
            },
            "discord": {
                "default": {
                    "color": "#FFFFFF",
                    "background": "#7289DA",
                    "border": "#7289DA",
                },
                "hover": {
                    "color": "#7289DA",
                    "background": "#FFFFFF",
                    "border": "#7289DA"
                }
            },
            "linktree": {
                "default": {
                    "color": "#FFFFFF",
                    "background": "#39e09b",
                    "border": "#39e09b",
                },
                "hover": {
                    "color": "#39e09b",
                    "background": "#FFFFFF",
                    "border": "#39e09b"
                }
            },
            "carrd": {
                "default": {
                    "color": "#FFFFFF",
                    "background": "#2C2F33",
                    "border": "#2C2F33",
                },
                "hover": {
                    "color": "#2C2F33",
                    "background": "#FFFFFF",
                    "border": "#2C2F33"
                }
            },
            "dribbble": {
                "default": {
                    "color": "#FFFFFF",
                    "background": "#EA4C89",
                    "border": "#EA4C89",
                },
                "hover": {
                    "color": "#EA4C89",
                    "background": "#FFFFFF",
                    "border": "#EA4C89"
                }
            },
        },

        /**
         * @constant {Object} buttonStyles - The button styles for the supported messaging apps
         * 
         * @since 0.0.1
         */
        buttonStyles: {
            "messaging": {
                "default": {
                    "color": "#FFFFFF",
                    "background": "#7289DA",
                    "border": "#7289DA",
                },
                "hover": {
                    "color": "#7289DA",
                    "background": "#FFFFFF",
                    "border": "#7289DA"
                }
            },
            "social": {
                "default": {
                    "color": "#FFFFFF",
                    "background": "#7289DA",
                    "border": "#7289DA",
                },
                "hover": {
                    "color": "#7289DA",
                    "background": "#FFFFFF",
                    "border": "#7289DA"
                }
            },
            "content": {
                "default": {
                    "color": "#FFFFFF",
                    "background": "#7289DA",
                    "border": "#7289DA",
                },
                "hover": {
                    "color": "#7289DA",
                    "background": "#FFFFFF",
                    "border": "#7289DA"
                }
            },
            "linkhub": {
                "default": {
                    "color": "#FFFFFF",
                    "background": "#7289DA",
                    "border": "#7289DA",
                },
                "hover": {
                    "color": "#7289DA",
                    "background": "#FFFFFF",
                    "border": "#7289DA"
                }
            }
        },

        /**
         * @constant {Object} buttonStylesOverrides - Style overrides for specific link types
         * 
         * @todo Probably integrate the brand colors into the linkTypes object instead of having a separate object for overrides and just use logic to handle the hover style inversions.
         * 
         * @since 0.0.1
         */
        buttonStylesOverrides: {
            // "bluesky": {
            // 	"default": {
            // //	 	"color": "rgb(0, 133, 255)",
            // //	 	"background": "#0000",
            // //	 	"border": "#0000",
            // 	},
            //	 "hover": {
            //		 "color": "#fff",
            //		 "background": "#0000",
            //		 "border": "#0000"
            //	 }
            // },
        },

        /**
         * @method setOptions
         * @description Sets the options for the script and merges the user's settings with the default options
         * 
         * @returns {boolean} result - Whether or not the options were set successfully
         */
        setOptions() {
            // Stub for now
            return true;
        },

        /**
         * @method getProfileBio
         * @description Retrieves the profile bio from the page
         * 
         * @param {string} selector - The selector for the profile bio element
         * 
         * @returns {object} result				 - The profile bio
         * @returns {element} result.element		- The profile bio element
         * @returns {string} result.text			- The profile bio text
         * @returns {string} result.html			- The profile bio html
         * @returns {object} result.links			- The profile bio links array
         * @returns {string} result.links.url			- The profile bio link url
         * @returns {string} result.links.text			- The profile bio link text
         * @returns {element} result.links.element		- The profile bio link element
         * 
         * @since 0.0.1
         * 
         * @todo Refactor the default selector to be a constant
         */
        getProfileBio(selector = "[data-testid='profileHeaderDescription']") {
            // Get all the profile bio elements
            let bio = document.querySelectorAll(selector);

            // Check which element is currently visible
            bio.forEach(element => {
                if (element.offsetParent !== null) {
                    bio = element;
                    return;
                }
            });

            // Return false if no profile bio element was found
            if (!bio || bio.length < 1) {
                return false;
            }

            // Create the result object
            let result = {
                element: bio,
                text: bio.innerText,
                html: bio.innerHTML,
                links: []
            };

            // Get the links from the profile bio
            let links = bio.querySelectorAll("a");

            // Add the links to the result object
            links.forEach(link => {
                result.links.push({
                    url: link.href,
                    text: link.innerText,
                    element: link
                });
            });

            // Return the result object
            return result;
        },

        /**
         * @method formatProfileBio
         * @description Formats the profile bio html to include markup for the inline links with icons.
         * 
         * @param {object} bio				- (See: function getProfileBio) The profile bio object
         * @param {object} linkTypes		- (See: const linkTypes) The link types, icons, and regexes for the supported messaging apps
         *
         * @returns {string} result			- The formatted profile bio html
         * 
         * @since 0.0.1
         */
        formatProfileBio(bio, args = { linkTypes: this.linkTypes, linkStyles: this.linkStyles, linkStylesOverrides: this.buttonStylesOverrides }) {
            // Get the arguments
            let linkTypes = args.linkTypes || this.linkTypes;
            let linkStyles = args.linkStyles || this.linkStyles;
            let linkStylesOverrides = args.linkStylesOverrides || this.buttonStylesOverrides;

            // Create the result string
            let result = bio.html;

            // Loop through the links in the profile bio
            bio.links.forEach(link => {
                // Loop through the link types
                for (const [key, value] of Object.entries(linkTypes)) {
                    // Check if the link matches the link type regex
                    if (link.url.match(value.regex)) {
                        // Get the link brand color
                        let linkColor = value.brand.color;

                        // Get the link style for the link type
                        let linkStyle = linkStyles[value.type];

                        // Override the linkStyle colors with the link brand color
                        linkStyle.default.background = linkColor;
                        linkStyle.default.border = linkColor;
                        linkStyle.hover.color = linkColor;
                        linkStyle.hover.border = linkColor;

                        // Check if the link type has a style override
                        if (linkStylesOverrides[key]) {		//TODO: Create a linkStylesOverrides object for this instead of using buttonStylesOverrides
                            linkStyle.default = Object.assign({}, linkStyle.default, linkStylesOverrides[key].default);
                            linkStyle.hover = Object.assign({}, linkStyle.hover, linkStylesOverrides[key].hover);
                        }

                        // Get the existing link element and its attributes
                        let linkOriginal = link.element;
                        let linkAttributes = linkOriginal.attributes;

                        // Create the hyperlink element
                        let hyperlink = document.createElement("a");

                        hyperlink.setAttribute("data-bsky-e", `profile-link-${key}`);

                        // Add the link attributes to the hyperlink element
                        for (let i = 0; i < linkAttributes.length; i++) {
                            hyperlink.setAttribute(linkAttributes[i].name, linkAttributes[i].value);
                        }

                        // Add the link style to the hyperlink element
                        let originalStyle = linkOriginal.getAttribute("style");
                        let newStyle = `
						color: ${linkStyle.default.color}; background: ${linkStyle.default.background}; border: 1px solid ${linkStyle.default.border}; border-radius: 0.5em;
						padding: 0.05em 0.2em; margin: 0 4px 4px 1px; text-decoration: none; font-size: 0.8em; font-weight: 600; display: inline-block; 
						transition: all 0.2s ease-in-out; white-space: nowrap;`;
                        hyperlink.setAttribute("style", `${originalStyle}; ${newStyle}`);

                        // Add the hover event styles to the hyperlink element
                        hyperlink.setAttribute("onmouseover", `this.style.color='${linkStyle.hover.color}'; this.style.background='${linkStyle.hover.background}'; this.style.border='1px solid ${linkStyle.hover.border}';`);
                        hyperlink.setAttribute("onmouseout", `this.style.color='${linkStyle.default.color}'; this.style.background='${linkStyle.default.background}'; this.style.border='1px solid ${linkStyle.default.border}';`);

                        // Add the link icon to the hyperlink element
                        let icon = document.createElement("i");
                        icon.setAttribute("class", value.icon);
                        icon.setAttribute("style", "margin-right: 4px;");
                        hyperlink.appendChild(icon);

                        // Add the link text to the hyperlink element
                        let text = document.createTextNode(link.text);
                        hyperlink.appendChild(text);

                        // Add the link title to the hyperlink element
                        hyperlink.setAttribute("title", value.name);

                        // Replace the existing link element with the hyperlink element
                        result = result.replace(linkOriginal.outerHTML, hyperlink.outerHTML);

                        // Break out of the loop
                        break;
                    }
                }
            });

            // Return the result string
            return result;
        },

        /**
         * @method insertProfileBio
         * @description Inserts the formatted profile bio html into the page
         * 
         * @param {string} element		- The profile bio element
         * @param {string} formattedBio	- The formatted profile bio html
         * 
         * @returns {boolean} result	- Whether or not the profile bio was inserted successfully
         * 
         * @since 0.0.1
         */
        insertProfileBio(element, formattedBio) {
            // Get the profile bio element
            let bio = element;

            // Check if the profile bio element exists
            if (bio && bio.innerHTML !== formattedBio && !bio.attributes["data-bsky-e"]) {
                // Insert the formatted profile bio html into the page
                bio.innerHTML = formattedBio;

                bio.setAttribute("data-bsky-e", "profile-bio");

                // Return true
                return true;
            }

            // Return false
            return false;
        },

        /**
         * @method formatProfileButtons
         * @description Formats the buttons to add to the profile page's header button group
         * 
         * @param {object} bio				- (See: function getProfileBio) The profile bio object
         * @param {object} linkTypes		- (See: const linkTypes) The link types, icons, and regexes for the supported messaging apps
         * @param {object} buttonStyles		- (See: const buttonStyles) The button styles for the supported messaging apps
         * 
         * @returns {string} result			- The formatted profile buttons html
         * 
         * @since 0.0.1
         */
        formatProfileButtons(bio, args = { linkTypes: this.linkTypes, buttonStyles: this.buttonStyles, buttonStylesOverrides: this.buttonStylesOverrides }) {
            // Get the arguments
            let linkTypes = args.linkTypes || this.linkTypes;
            let buttonStyles = args.buttonStyles || this.buttonStyles;
            let buttonStylesOverrides = args.buttonStylesOverrides || this.buttonStylesOverrides;

            // Create the result DOM element array
            let result = [];

            // Loop through the links in the profile bio
            bio.links.forEach(link => {
                // Loop through the link types
                for (const [key, value] of Object.entries(linkTypes)) {
                    // Check if the link matches the link type regex
                    if (link.url.match(value.regex)) {
                        // Check if the link type is in the button types array and continue if it isn't
                        if (!this.options.buttonTypes.includes(value.type)) {
                            break;
                        }

                        // Get the button style for the link type
                        let buttonStyle = buttonStyles[value.type];

                        // Check if the link type has a style override
                        if (buttonStylesOverrides[key]) {
                            buttonStyle.default = Object.assign({}, buttonStyle.default, buttonStylesOverrides[key].default);
                            buttonStyle.hover = Object.assign({}, buttonStyle.hover, buttonStylesOverrides[key].hover);
                        }

                        // Create the button element
                        let button = document.createElement("button");

                        button.setAttribute("data-bsky-e", `profile-button-${key}`);

                        // Add the button attributes to the button element
                        button.setAttribute("title", `${value.name} - ${link.text}`);
                        button.setAttribute("aria-label", `${value.name} - ${link.text}`);
                        button.setAttribute("onclick", `window.open('${link.url}', '_blank');`);
                        button.setAttribute("style", `
						color: ${buttonStyle.default.color}; background: ${buttonStyle.default.background}; border: 1px solid ${buttonStyle.default.border}; border-radius: 2em;
						aspect-ratio: 1; height: 100%; margin: 0 4px; text-decoration: none; font-size: 0.8em; font-weight: 600; display: block;
						transition: all 0.2s ease-in-out; white-space: nowrap; cursor: pointer;`);

                        // Add the hover event styles to the button element
                        button.setAttribute("onmouseover", `this.style.color='${buttonStyle.hover.color}'; this.style.background='${buttonStyle.hover.background}'; this.style.border='1px solid ${buttonStyle.hover.border}';`);
                        button.setAttribute("onmouseout", `this.style.color='${buttonStyle.default.color}'; this.style.background='${buttonStyle.default.background}'; this.style.border='1px solid ${buttonStyle.default.border}';`);

                        // Add the button icon to the button element
                        let icon = document.createElement("i");
                        icon.setAttribute("class", value.icon);
                        button.appendChild(icon);

                        // // Add the button text to the button element
                        // let text = document.createTextNode(link.text);
                        // button.appendChild(text);

                        // Add the button to the result array
                        result.push(button);

                        // Break out of the loop
                        break;
                    }
                }
            });

            // Return the result string
            return result;
        },

        /**
         * @method insertProfileButtons
         * @description Inserts the formatted profile buttons html into the page
         * 
         * @param {string} element		  	- The profile bio element
         * @param {string} formattedButtons	- The formatted profile buttons html
         * 
         * @returns {boolean} result		- Whether or not the profile buttons were inserted successfully
         * 
         * @since 0.0.1
         */
        insertProfileButtons(element, formattedButtons) {
            // Get the profile bio element
            let bio = element;

            // Check if the profile bio element exists
            if (!bio) {
                return false;
            }

            // Get the profile header element
            let header = bio.closest("[data-testid='profileView']");

            // Get the profile header button group element
            let buttonGroup = header.querySelector("div.css-175oi2r.r-2llsf > div:nth-child(1) > div > div:nth-child(2) > div.css-175oi2r.r-12vffkv");

            // Check if the profile header button group element exists
            if (!buttonGroup) {
                return false;
            }

            // Insert the formatted profile buttons html into the page
            formattedButtons.forEach(button => {
                // Check if the button already exists
                if (buttonGroup.querySelector(`[title="${button.title}"]`)) { // TODO: Implement a check for existing buttons that doesn't rely on checking the DOM
                    return;
                }

                buttonGroup.prepend(button);
            });

            return true;
        },

        /**
         * @method isProfilePage
         * @description Checks if the current page is a profile page
         * 
         * @returns {boolean} result		- Whether or not the current page is a profile page
         * 
         * @since 0.0.1
         */
        isProfilePage() {
            // Get the current page url
            let url = window.location.href;

            // Check if the current page url matches the profile page url (/profile/*)
            if (url.match(/\/profile\/([a-zA-Z0-9_]+)/)) {
                return true;
            }

            return false;
        },

        /**
         * @method runProfilePage
         * @description Runs the script on the profile page
         * 
         * @since 0.0.1
         */
        runProfilePage() {
            // Check if the current page is a profile page
            if (!this.isProfilePage()) {
                return;
            }

            // Get the profile bio
            let bio = this.getProfileBio();

            // Check if the profile bio exists
            if (!bio) {
                return false;
            }

            // Check if the profile bio has any links
            if (bio.links.length > 0) {
                // Format the profile bio
                let formattedBio = this.formatProfileBio(bio, { linkTypes: this.linkTypes, linkStyles: this.linkStyles });

                // Insert the formatted profile bio
                this.insertProfileBio(bio.element, formattedBio);

                // Format the profile buttons
                let formattedButtons = this.formatProfileButtons(bio, { linkTypes: this.linkTypes, buttonStyles: this.buttonStyles, buttonStylesOverrides: this.buttonStylesOverrides });

                // Insert the formatted profile buttons
                this.insertProfileButtons(bio.element, formattedButtons);
            }

            // Parse emojis
            this.parrent.emoji.parseEmojis(bio.element);
        },


        /**
         * @method init
         * @description Intialize the script and binds it to the navigate event
         * 
         * @since 0.0.1
         */
        init() {
            // Set the options for the script
            this.setOptions();

            // Run the script on page load
            this.runProfilePage();

            document.addEventListener("DOMContentLoaded", () => {
                console.log("DOMContentLoaded");
                this.runProfilePage();
            });

            // Bind the script to the navigate event
            window.addEventListener("navigate", () => {
                console.log("navigate");
                this.runProfilePage();
            });

            // Bind the script to the popstate event
            window.addEventListener("popstate", () => {
                console.log("popstate");
                this.runProfilePage();
            });

            // Create a MutationObserver instance
            const observer = new MutationObserver((mutations) => {
                if (window.pause_event !== true) {
                    mutations.forEach((mutation) => {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                // Avoid infinite loops, don't run on the script's own elements
                                const element = node.closest && node.closest("[data-bsky-e]");
                                if (!element) {
                                    // Run the script on detected changes
                                    this.runProfilePage();
                                }
                            }
                        });
                    });
                    // Run the script on page load
                    this.runProfilePage();
                }
            });

            // Configure the observer with the desired settings
            observer.observe(document.body, {
                childList: true,  // Watch for added or removed child nodes
                subtree: true     // Watch all descendant nodes
            });
        }
    },
    api_intercept: {
        /**
         * @property {object} xhook
         * @description The xhook object
         * 
         * @since 0.0.3
         */
        xhook: null,

        /**
         * @constant {array} apiEndpoints
         * @description The API endpoints for the script to intercept as well as the paths to the data in the response
         * 
         * @since 0.0.3
         */
        apiEndpoints: {
            "app.bsky.actor.getProfile": {
                "fields": {
                    "displayName": {
                        "location": "displayName",
                    },
                    "description": {
                        "location": "description",
                    },
                },
            },
            "app.bsky.feed.getAuthorFeed": {
                "fields": {
                    "post_displayName": {
                        "location": "feed[i].post.author.displayName",
                    },
                    "post_content": {
                        "location": "feed[i].post.record.text",
                    },
                },
            },
            "app.bsky.feed.getTimeline": {
                "fields": {
                    "post_displayName": {
                        "location": "feed[i].post.author.displayName",
                    },
                    "post_content": {
                        "location": "feed[i].post.record.text",
                    },
                },
            },
            "app.bsky.feed.getFeed": {
                "fields": {
                    "post_displayName": {
                        "location": "feed[i].post.author.displayName",
                    },
                    "post_content": {
                        "location": "feed[i].post.record.text",
                    },
                },
            },
            "app.bsky.feed.getPostThread": {
                "fields": {
                    "post_displayName": {
                        "location": "thread.post.author.displayName",
                    },
                    "post_content": {
                        "location": "thread.post.record.text",
                    },
                    "parent_displayName": {
                        "location": "thread.parent.post.author.displayName",
                    },
                    "parent_content": {
                        "location": "thread.parent.post.record.text",
                    },
                    "reply_displayName": {
                        "location": "thread.replies[i].post.author.displayName",
                    },
                    "reply_content": {
                        "location": "thread.replies[i].post.record.text",
                    },
                },
            }
        },

        /**
         * @constructor
         * 
         * @param {object} args	- The arguments for the class
         * 
         * @since 0.0.3
         */
        constructor(args = {}) {
            // Initialize the script
            this.init();
        },

        /**
         * @method init
         * @description Intialize the script
         * 
         * @since 0.0.3
         */
        init() {
            const apiEndpointURLsArray = Object.keys(this.apiEndpoints);

            // Bind the script to the xhook before event
            this.xhook.after((request, response) => {
                // Get the request API endpoint from the request url by taking the part after the last slash and before the question mark
                let requestAPIEndpointURL = request.url.split("/").pop().split("?")[0];

                // Check if the request url matches any of the api endpoints
                if (apiEndpointURLsArray.includes(requestAPIEndpointURL)) {
                    console.log(`requestAPIEndpointURL: ${requestAPIEndpointURL}`)
                    this.parseResponse(response, { apiEndpointURL: requestAPIEndpointURL });
                }
            });
        },

        /**
         * @method parseResponse
         * @description Parses the response
         * 
         * @param {object} response				- The response to parse
         * @param {object} args 				- The arguments for the function
         * @param {string} args.apiEndpointURL	- The API endpoint URL
         * @param {object} args.fields			- The fields to parse from the response item
         * @param {function} args.parser		- The parser function to use to parse the response item
         * 
         * @returns {object} result			- The parsed response
         * 
         * @since 0.0.3
         */
        parseResponse(response, args = { fields: {}, parser: false }) {
            // Get the arguments
            let apiEndpointURL = args.apiEndpointURL || false;
            let fields = args.fields || this.apiEndpoints[apiEndpointURL].fields;
            let parser = args.parser || (() => { });

            // Check if the response is valid
            if (!response) {
                return false;
            }

            // Find the fields in the response
            Object.entries(fields).forEach(([key, value]) => {
                console.log(1, `key: ${key}, value: `, value);
                let fieldName = key;
                let fieldLocation = value.location;
                let fieldLocationArray = fieldLocation.split(".");
                let fieldLocationIterator = 0;

                // Check if the field location is valid
                if (!fieldLocation) {
                    return false;
                }

                // Check if the field location has an array index
                for (let i = 0; i < fieldLocationArray.length; i++) {
                    let fieldLocationArrayItem = fieldLocationArray[i];

                    if (fieldLocationArrayItem.match(/\[i\]/)) {
                        // Get the index of the field location array item
                        fieldLocationIterator = i;

                        // Remove the array index from the field location array item
                        fieldLocationArray[i] = fieldLocationArrayItem.replace(/\[i\]/, "");

                        // Stop the loop
                        break;
                    }
                }

                console.log(2, `fieldLocation: ${fieldLocation}, fieldLocationIterator: ${fieldLocationIterator}`);

                // Iterate through the field location array at the index of the field location iterator
                let fieldValue = response.data || response;

                if (fieldLocationIterator > 0) {
                    let fieldLocationArrayIteratorSubset = fieldLocationArray.slice(fieldLocationIterator);

                    console.log(3, `fieldLocationArrayIteratorSubset: `, fieldLocationArrayIteratorSubset);

                    // Get the array at the field location
                    fieldValueList = fieldLocationArrayIteratorSubset.reduce((accumulator, currentValue) => {
                        return accumulator[currentValue];
                    }, fieldValue);

                    console.log(4, `fieldValueList: `, fieldValueList);

                    // // Iterate through the array at the field location
                    // fieldValueList.forEach( (fieldValueListItem, index) => {
                    // 	// Parse the field value
                    // 	parser( fieldValueListItem );

                    // 	// Transform to allcaps
                    // 	fieldValue = fieldValue.toUpperCase();
                    // });
                } else {

                    console.log(5, `fieldValue: `, fieldValue);

                    // // Get the field value from the field location
                    // fieldValue2 = fieldLocationArray.reduce( (accumulator, currentValue) => {
                    // 	return accumulator[currentValue];
                    // }, fieldValue );

                    // // Parse the field value
                    // parser( fieldValue );

                    // // Transform to allcaps
                    // fieldValue = fieldValue.toUpperCase();
                }



                // // Check if the field value is valid
                // if ( !fieldValue ) {
                // 	return false;
                // }

                // // Parse the field value
                // parser( fieldValue );

                // // Transform to allcaps
                // fieldValue = fieldValue.toUpperCase();
            });

            return true;
        },

        /**
         * @method getAPIEndpoints
         * @description Gets the API endpoints
         * 
         * @returns {object} result	- The API endpoints
         * 
         * @since 0.0.3
         */
        getAPIEndpoints() {
            return this.apiEndpoints;
        },

        /**
         * @method setAPIEndpoints
         * @description Sets the API endpoints
         * 
         * @param {object} apiEndpoints	- The API endpoints to set
         * 
         * @returns {boolean} result		- Whether or not the API endpoints were set successfully
         * 
         * @since 0.0.3
         */
        setAPIEndpoints(apiEndpoints) {
            // Check if the API endpoints are valid
            if (typeof apiEndpoints !== "object") {
                return false;
            }

            // Set the API endpoints
            this.apiEndpoints = apiEndpoints;

            return true;
        },

        /**
         * @method addAPIEndpoint
         * @description Adds an API endpoint
         * 
         * @param {string} endpoint		- The API endpoint to add
         * @param {object} fields		- The fields to parse from the response item
         * @param {string} fields.location	- The location of the field in the response item
         * 
         * @returns {boolean} result	- Whether or not the API endpoint was added successfully
         * 
         * @since 0.0.3
         */
        addAPIEndpoint(endpoint, fields) {
            // Check if the endpoint is valid
            if (typeof endpoint !== "string") {
                return false;
            }

            // Check if the fields are valid
            if (typeof fields !== "object") {
                return false;
            }

            // Add the endpoint to the API endpoints
            this.apiEndpoints[endpoint] = fields;

            return true;
        },

        /**
         * @method removeAPIEndpoint
         * @description Removes an API endpoint
         * 
         * @param {string} endpoint		- The API endpoint to remove
         *
         * @returns {boolean} result	- Whether or not the API endpoint was removed successfully
         * 
         * @since 0.0.3
         */
        removeAPIEndpoint(endpoint) {
            // Check if the endpoint is valid
            if (typeof endpoint !== "string") {
                return false;
            }

            // Remove the endpoint from the API endpoints
            delete this.apiEndpoints[endpoint];

            return true;
        },

        /**
         * @method storeAPIEndpoints
         * @description Stores the API endpoints in local storage
         * 
         * @returns {boolean} result	- Whether or not the API endpoints were stored successfully
         * 
         * @since 0.0.3
         */
        storeAPIEndpoints() {
            // Stub for now
            return true;
        },

        /**
         * @method loadAPIEndpoints
         * @description Loads the API endpoints from local storage
         * 
         * @returns {boolean} result	- Whether or not the API endpoints were loaded successfully
         */
        loadAPIEndpoints() {
            // Stub for now
            return true;
        }
    }
};

//############################################//

// Initialize needed variables
BskyExt.profile.parrent = BskyExt;

// Initialize the emoji parsing
BskyExt.emoji.init();

// Initialize the profile script
BskyExt.profile.init();