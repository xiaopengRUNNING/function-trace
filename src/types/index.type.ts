import { DocumentSymbol, Range } from 'vscode';
import { SyntaxNode } from 'web-tree-sitter';

export interface IDocumentSymbol extends DocumentSymbol {
  comment?: string;
}
