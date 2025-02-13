const usercssMeta = require('usercss-meta');
const less = require('less');
const stylus = require('stylus');

/**
 * Extracts all global variable and mixin definitions from CSS.
 * @param {string} css - The CSS string.
 * @returns {string} The extracted global definitions.
 */
function extractGlobalDefinitions(css) {
    const globalDefinitionRegex = /(@[\w-]+\s*(?:{[^}]*}|;))/g;
    return (css.match(globalDefinitionRegex) || []).join('\n');
}

/**
 * Extracts variable definitions from metadata.
 * @param {object} metadata - Metadata containing variable definitions.
 * @returns {object} A map of variable names to their default values.
 */
function extractMetadataVars(metadata) {
    if (!metadata?.vars) return {};
    return Object.fromEntries(
        Object.entries(metadata.vars).map(([key, value]) => [key, value.default || value.value || null])
    );
}

/**
 * Extracts content enclosed within matching braces starting from a given position.
 * @param {string} css - The CSS string.
 * @param {number} startPos - The starting position to search for braces.
 * @returns {object|null} The content and ending position of the matched braces.
 */
function extractBracedContent(css, startPos) {
    const braceMatch = matchBraces(css, startPos);
    if (!braceMatch) return null;

    return {
        content: css.substring(braceMatch.start + 1, braceMatch.end - 1).trim(),
        end: braceMatch.end,
    };
}

/**
 * Matches a pair of braces in a string starting from a given position.
 * @param {string} content - The string content.
 * @param {number} start - The starting position to search for braces.
 * @returns {object|null} The start and end positions of the matched braces.
 */
function matchBraces(content, start) {
    const openBrace = content.indexOf('{', start);
    if (openBrace === -1) return null;

    let braceCount = 1, pos = openBrace + 1;
    while (braceCount > 0 && pos < content.length) {
        if (content[pos] === '{') braceCount++;
        if (content[pos] === '}') braceCount--;
        pos++;
    }

    return braceCount === 0 ? { start: openBrace, end: pos } : null;
}

/**
 * Parses domain rules from the provided CSS string.
 * @param {string} css - The CSS string.
 * @param {number} startPos - The starting position to search for domain rules.
 * @returns {object|null} The domains and the rule start position.
 */
function parseDomainRule(css, startPos) {
    const domainRuleRegex = /@-moz-document\s+domain\(\s*'([^']+)'(?:\s*,\s*'([^']+)')*\s*\)/g;
    domainRuleRegex.lastIndex = startPos;
    const match = domainRuleRegex.exec(css);
    if (!match) return null;

    const domains = match[0]
        .match(/['"][^'"]+['"]/g) // Extract all single- or double-quoted domain values
        .map(domain => domain.replace(/['"]/g, '').trim()); // Remove quotes and trim whitespace

    return {
        domains,
        ruleStart: match.index + match[0].length - 1,
    };
}

/**
 * Parses @-moz-document rules and extracts domain-specific CSS.
 * @param {string} css - The CSS string.
 * @returns {object} A map of domains to their associated CSS.
 */
function parseMozRules(css) {
    const rules = {};
    let currentPos = 0;

    // Helper to extract global definitions (CSS outside @-moz-document)
    const globalCode = extractGlobalDefinitions(css);

    while (currentPos < css.length) {
        // Match @-moz-document syntax and extract domains
        const domainMatch = css.slice(currentPos).match(/@-moz-document\s+(.*?){/s);
        if (!domainMatch) break;

        const domainsStr = domainMatch[1];
        const ruleStart = currentPos + domainMatch.index + domainMatch[0].length - 1;

        // Extract the content inside the braces for this @-moz-document rule
        const bracedContent = extractBracedContent(css, ruleStart);
        if (!bracedContent) break;

        // Parse the domains and add the CSS to each
        const domainList = domainsStr.match(/domain\("([^"]+)"\)/g) || [];
        const domains = domainList.map((d) => d.match(/domain\("([^"]+)"\)/)[1]);

        for (const domain of domains) {
            rules[domain] = `${globalCode}\n${bracedContent.content}`;
        }

        currentPos = bracedContent.end;
    }

    return rules;
}

/**
 * Parses metadata from the provided CSS string.
 * @param {string} css - The CSS string.
 * @returns {object} Parsed metadata.
 */
function parseCSS(css) {
    try {
        const normalizedCss = css.replace(/\r\n?/g, '\n');
        const nocommentsCss = normalizedCss.replace(/\/\*[\s\S]*?\*\//g, ''); // Remove comments
        return {
            ...usercssMeta.parse(normalizedCss),
            css: nocommentsCss,
        };
    } catch (error) {
        throw new Error(`Failed to parse CSS metadata: ${error.message}`);
    }
}

/**
 * Compiles CSS code with a preprocessor if specified in the metadata.
 * @param {string} code - The CSS code.
 * @param {object} metadata - Metadata containing preprocessor information.
 * @param {object} [userVars={}] - User-defined variables to override defaults.
 * @returns {Promise<{compiledCss: string, sites: object}>} The compiled CSS code and domain-specific mapping.
 */
async function compileStyle(code, metadata, userVars = {}) {
    try {
        // Extract and merge variables
        const vars = {
            ...extractMetadataVars(metadata),
            ...userVars
        };

        // Generate full code with user variables
        const fullCode = [
            '// User variables',
            Object.entries(vars).map(([key, value]) => `@${key}: ${value};`).join('\n'),
            '// Main code',
            code
        ].join('\n\n');

        let compiledCode;

        switch (metadata?.preprocessor?.toLowerCase()) {
            case 'less':
                compiledCode = await compileLess(fullCode, vars);
                break;
            case 'stylus':
                compiledCode = await compileStylus(fullCode, vars);
                break;
            case 'sass':
                throw Error('SASS preprocessor not supported yet. Skipping compilation.');
            case 'scss':
                throw Error('SCSS preprocessor not supported yet. Skipping compilation.');
            default:
                compiledCode = code; // Return unmodified for plain CSS/unknown preprocessor
        }

        // Parse domain rules
        const domainRules = parseMozRules(compiledCode);

        // Compile each domain's CSS if needed
        const compiledRules = {};
        for (const [domain, css] of Object.entries(domainRules)) {
            switch (metadata.preprocessor?.toLowerCase()) {
                case 'less':
                    compiledRules[domain] = await compileLess(css, vars);
                    break;
                case 'stylus':
                    compiledRules[domain] = await compileStylus(css, vars);
                    break;
                default:
                    compiledRules[domain] = css;
            }
        }

        // Combine all CSS
        const combinedCss = Object.entries(compiledRules)
            .map(([domain, compiledCss]) => `/* ${domain} */\n${compiledCss}`)
            .join('\n\n');

        return {
            compiledCss: combinedCss,
            sites: compiledRules, // Map of domains to their CSS
        };

    } catch (error) {
        //console.error('Style compilation error:', error);
        return {
            error
        };
    }
}

/**
 * Compiles LESS code to CSS.
 * @param {string} code - The LESS code.
 * @param {object} vars - User-defined variables.
 * @returns {Promise<string>} The compiled CSS.
 */
async function compileLess(code, vars = {}) {
    return new Promise((resolve, reject) => {
        less.render(code, {
            math: 'parens-division',
            javascriptEnabled: true,
            compress: false,
            globalVars: vars
        }, (err, output) => {
            if (err) return reject(err);
            resolve(output.css);
        });
    });
}

/**
 * Compiles Stylus code to CSS.
 * @param {string} code - The Stylus code.
 * @returns {Promise<string>} The compiled CSS.
 */
async function compileStylus(code, vars = {}) {
    console.log(vars, code);
    return new Promise((resolve, reject) => {
        var stlus = stylus(code);
        stlus.set('compress', false);
        for (const [key, value] of Object.entries(vars)) {
            stlus.define(key, value);
        }
        stlus.render((err, output) => {
            if (err) return reject(err);
            resolve(output);
        });
    });
}

module.exports = {
    parseCSS,
    compileStyle
};