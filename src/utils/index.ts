import * as vscode from 'vscode';
import { SyntaxNode } from 'web-tree-sitter';
import { ISyntaxNode } from '../types/index.type';

/** Format function comments */
export function formatComment(comment: string) {
  if (/^\s*\/\//.test(comment)) {
    const match = comment.match(/\/\/\s*(.+)/);
    return match?.[1].trim() ?? '';
  }
  if (/^\s*\/\*\*/.test(comment)) {
    if (comment.includes('\n')) {
      let match = comment.match(/\/\*\*\s*\n\s*\*(.*)\n\s*\*\//);

      if (!match) {
        match = comment.match(/\s*\*\s*@Description:\s*(.*)/);
      }

      return match?.[1].trim() ?? '';
    } else {
      const match = comment.match(/^\s*\/\*\*\s+(.*?)(?=\s*\*\/\s*$)/);
      return match?.[1].trim() ?? '';
    }
  }
  return '';
}

/** Get the full definition of the arrow function */
export function getArrowFunctionDefinition(node: SyntaxNode) {
  let result: SyntaxNode | null = node;
  while (result?.type && result?.type !== 'lexical_declaration') {
    result = result?.parent;
  }
  return result;
}

/** Check if it is a child */
export function isChildOf(parent: ISyntaxNode, child: ISyntaxNode) {
  return (
    child.syntaxNode.startIndex >= parent.syntaxNode.startIndex &&
    child.syntaxNode.endIndex <= parent.syntaxNode.endIndex
  );
}

/** Generate a Tree Structure */
export function buildFunctionTree(list: ISyntaxNode[]) {
  const rootFunctions: ISyntaxNode[] = [];
  const parentStack: ISyntaxNode[] = [];

  list.forEach(node => {
    const functionItem = {
      ...node,
      children: []
    };

    while (
      parentStack.length > 0 &&
      !isChildOf(parentStack[parentStack.length - 1], node)
    ) {
      parentStack.pop();
    }

    if (parentStack.length === 0) {
      rootFunctions.push(functionItem);
    } else {
      parentStack[parentStack.length - 1].children?.push(functionItem);
    }

    parentStack.push(functionItem);
  });
  return rootFunctions;
}

/** Iterate to get the starting and ending rows for all node areas */
export function getAllNodeStartAndEndRow(node?: ISyntaxNode[]) {
  if (!node) {
    return [];
  }
  const result: { start: number; end: number }[] = [];
  node.forEach(item => {
    result.push({
      start: item.syntaxNode.startPosition.row,
      end: item.syntaxNode.endPosition.row
    });
    if (item.children && item.children.length) {
      result.push(...getAllNodeStartAndEndRow(item.children));
    }
  });
  return result;
}

/** Fold or unfold all code */
export async function FoldOrUnfoldAllCode() {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    // Get the range of currently visible rows
    const initialVisibleRanges = editor.visibleRanges.map(
      range => new vscode.Range(range.start, range.end)
    );

    // Execute the command to collapse all the code
    await vscode.commands.executeCommand('editor.foldAll');

    // Get the visible range post-folding
    const foldedVisibleRanges = editor.visibleRanges.map(
      range => new vscode.Range(range.start, range.end)
    );

    const isFullyFolded = foldedVisibleRanges.every((foldedRange, index) => {
      const initialRange = initialVisibleRanges[index];
      return foldedRange.isEqual(initialRange);
    });

    if (isFullyFolded) {
      vscode.commands.executeCommand('editor.unfoldAll');
      // update icon status
      vscode.commands.executeCommand(
        'setContext',
        'functionMapView.isAllFolded',
        false
      );
    } else {
      vscode.commands.executeCommand('editor.foldAll');
      // update icon status
      vscode.commands.executeCommand(
        'setContext',
        'functionMapView.isAllFolded',
        true
      );
    }
  }
}

/** Fold or unfold specify range code */
export function FoldOrUnfoldRangeCode(
  range: vscode.Range,
  children?: ISyntaxNode[]
) {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const visibleRanges = editor.visibleRanges;

    let isRangeFolded = true;

    for (const visibleRange of visibleRanges) {
      if (visibleRange.contains(range)) {
        isRangeFolded = false; // If the target range is within the visible range, it indicates that it is not collapsed.
      }
    }

    const childrenNode = getAllNodeStartAndEndRow(children);
    childrenNode?.forEach(item => {
      if (isRangeFolded) {
        vscode.commands.executeCommand('editor.unfold', {
          selectionLines: [item.start, item.end]
        });
      } else {
        vscode.commands.executeCommand('editor.fold', {
          selectionLines: [item.start, item.end]
        });
      }
    });

    editor.selection = new vscode.Selection(range.start, range.end);
    if (isRangeFolded) {
      vscode.commands.executeCommand('editor.unfold');
    } else {
      vscode.commands.executeCommand('editor.fold');
    }
    return !isRangeFolded;
  }
  return null;
}
