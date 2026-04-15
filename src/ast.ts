import * as path from 'path';
import * as Parser from 'web-tree-sitter';

export interface CodeBlock {
    name: string;
    type: 'Class' | 'Function' | 'Method' | 'Module';
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

        try {
            const tsLang = await Parser.Language.load(tsWasmPath);
            const jsLang = await Parser.Language.load(jsWasmPath);
            this.languages.set('ts', tsLang);
            this.languages.set('typescript', tsLang);
            this.languages.set('js', jsLang);
            this.languages.set('javascript', jsLang);
        } catch (err) {
            console.error('Failed to load Tree-sitter grammars:', err);
        }
    }

    public extractBlocks(content: string, language: string): CodeBlock[] {
        if (!this.parser) return [];
        
        const lang = this.languages.get(language);
        if (!lang) return [];

        this.parser.setLanguage(lang);
        const tree = this.parser.parse(content);
        if (!tree) return [];

        const blocks: CodeBlock[] = [];

        // Recursive traversal
        const traverse = (node: Parser.Node) => {
            let block: CodeBlock | null = null;

            if (node.type === 'class_declaration') {
                const nameNode = node.childForFieldName('name');
                block = {
                    name: nameNode ? nameNode.text : 'AnonymousClass',
                    type: 'Class',
                    code_body: this.getFullNodeText(node, content),
                    start_line: node.startPosition.row + 1,
                    end_line: node.endPosition.row + 1
                };
            } else if (node.type === 'function_declaration') {
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

            if (block) {
                blocks.push(block);
            }

            for (const child of node.children) {
                traverse(child);
            }
        };

        traverse(tree.rootNode);
        return blocks;
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
