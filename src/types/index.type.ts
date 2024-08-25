import { Range } from 'vscode';
import { SyntaxNode } from 'web-tree-sitter';

export interface ISyntaxNode {
  vscodeRange: Range;
  isFolded: boolean;
  name: string;
  syntaxNode: SyntaxNode;
  children?: ISyntaxNode[];
}
