import * as path from 'path';
import * as Parser from 'web-tree-sitter';

export type BlockType = 'Class' | 'Function' | 'Method' | 'Module' | 'Header' | 'Paragraph' | 'CodeSnippet' | 'Object' | 'Array' | 'RawText';

export interface CodeBlock {
    name: string;
    type: BlockType;
    code_body: string;
    start_line: number;
    end_line: number;
}

export class ASTParser {
    private parser: Parser.Parser | null = null;
    private languages: Map<string, Parser.Language> = new Map();

    public async init(extensionPath: string) {
        if (this.parser) return;

        await Parser.Parser.init({
            locateFile: () => path.join(extensionPath, 'assets', 'web-tree-sitter.wasm')
        });

        this.parser = new Parser.Parser();

        const tsWasmPath = path.join(extensionPath, 'assets', 'tree-sitter-typescript.wasm');
        const jsWasmPath = path.join(extensionPath, 'assets', 'tree-sitter-javascript.wasm');
        const pyWasmPath = path.join(extensionPath, 'assets', 'tree-sitter-python.wasm');
        const jsonWasmPath = path.join(extensionPath, 'assets', 'tree-sitter-json.wasm');
        const mdWasmPath = path.join(extensionPath, 'assets', 'tree-sitter-markdown.wasm');

        try {
            const tsLang = await Parser.Language.load(tsWasmPath);
            const jsLang = await Parser.Language.load(jsWasmPath);
            const pyLang = await Parser.Language.load(pyWasmPath);
            const jsonLang = await Parser.Language.load(jsonWasmPath);
            const mdLang = await Parser.Language.load(mdWasmPath);

            this.languages.set('ts', tsLang);
            this.languages.set('typescript', tsLang);
            this.languages.set('js', jsLang);
            this.languages.set('javascript', jsLang);
            this.languages.set('py', pyLang);
            this.languages.set('python', pyLang);
            this.languages.set('json', jsonLang);
            this.languages.set('md', mdLang);
            this.languages.set('markdown', mdLang);
        } catch (err) {
            console.error('Failed to load Tree-sitter grammars:', err);
        }
    }

    public extractBlocks(content: string, language: string): CodeBlock[] {
        if (!this.parser) return this.createFallbackBlock(content);
        
        const lang = this.languages.get(language);
        if (!lang) return this.createFallbackBlock(content);

        this.parser.setLanguage(lang);
        const tree = this.parser.parse(content);
        if (!tree) return this.createFallbackBlock(content);

        const blocks: CodeBlock[] = [];

        // Recursive traversal
        const traverse = (node: Parser.Node, depth: number = 0) => {
            let block: CodeBlock | null = null;

            // TS/JS & Python Logic
            if (['typescript', 'javascript', 'ts', 'js', 'python', 'py'].includes(language)) {
                if (node.type === 'class_declaration' || node.type === 'class_definition') {
                    const nameNode = node.childForFieldName('name');
                    block = {
                        name: nameNode ? nameNode.text : 'AnonymousClass',
                        type: 'Class',
                        code_body: this.getFullNodeText(node, content),
                        start_line: node.startPosition.row + 1,
                        end_line: node.endPosition.row + 1
                    };
                } else if (node.type === 'function_declaration' || node.type === 'function_definition') {
                    const nameNode = node.childForFieldName('name');
                    block = {
                        name: nameNode ? nameNode.text : `anon_func_L${node.startPosition.row + 1}`,
                        type: 'Function',
                        code_body: this.getFullNodeText(node, content),
                        start_line: node.startPosition.row + 1,
                        end_line: node.endPosition.row + 1
                    };
                } else if (node.type === 'method_definition') {
                    const nameNode = node.childForFieldName('name');
                    block = {
                        name: nameNode ? nameNode.text : `anon_method_L${node.startPosition.row + 1}`,
                        type: 'Method',
                        code_body: this.getFullNodeText(node, content),
                        start_line: node.startPosition.row + 1,
                        end_line: node.endPosition.row + 1
                    };
                }
            } 
            // JSON Logic (Strictly Top-level)
            else if (language === 'json') {
                if (depth === 1 && (node.type === 'object' || node.type === 'array')) {
                    block = {
                        name: `${node.type}_L${node.startPosition.row + 1}`,
                        type: node.type === 'object' ? 'Object' : 'Array',
                        code_body: content.substring(node.startIndex, node.endIndex),
                        start_line: node.startPosition.row + 1,
                        end_line: node.endPosition.row + 1
                    };
                }
            }
            // Markdown Logic
            else if (['markdown', 'md'].includes(language)) {
                if (node.type === 'atx_heading') {
                    const textNode = node.children.find(c => c.type === 'inline');
                    block = {
                        name: textNode ? `Header: ${textNode.text.trim()}` : `Header_L${node.startPosition.row + 1}`,
                        type: 'Header',
                        code_body: content.substring(node.startIndex, node.endIndex),
                        start_line: node.startPosition.row + 1,
                        end_line: node.endPosition.row + 1
                    };
                } else if (node.type === 'paragraph') {
                    block = {
                        name: `Paragraph_L${node.startPosition.row + 1}`,
                        type: 'Paragraph',
                        code_body: content.substring(node.startIndex, node.endIndex),
                        start_line: node.startPosition.row + 1,
                        end_line: node.endPosition.row + 1
                    };
                } else if (node.type === 'fenced_code_block') {
                    block = {
                        name: `CodeSnippet_L${node.startPosition.row + 1}`,
                        type: 'CodeSnippet',
                        code_body: content.substring(node.startIndex, node.endIndex),
                        start_line: node.startPosition.row + 1,
                        end_line: node.endPosition.row + 1
                    };
                }
            }

            if (block) {
                blocks.push(block);
            }

            // Don't recurse into JSON objects/arrays to keep it top-level
            if (language === 'json' && block) return;

            for (const child of node.children) {
                traverse(child, depth + 1);
            }
        };

        traverse(tree.rootNode);

        // Fallback if no blocks found (or empty file)
        if (blocks.length === 0) {
            return this.createFallbackBlock(content);
        }

        return blocks;
    }

    private createFallbackBlock(content: string): CodeBlock[] {
        return [{
            name: 'FullContent',
            type: 'RawText',
            code_body: content,
            start_line: 1,
            end_line: content.split('\n').length
        }];
    }

    private getFullNodeText(node: Parser.Node, content: string): string {
        let startIndex = node.startIndex;
        
        // Find leading comments
        let prev = node.previousSibling;
        while (prev && (prev.type === 'comment' || prev.type === 'line_comment')) {
            startIndex = prev.startIndex;
            prev = prev.previousSibling;
        }

        return content.substring(startIndex, node.endIndex);
    }
}
