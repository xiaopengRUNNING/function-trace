import * as vscode from 'vscode';
import { IDocumentSymbol } from '../types/index.type';
import { DocumentSymbol } from 'vscode';

export function judgeIsFunction(text: string): boolean {
  const functionRegex =
    /\b\w+\s*=\s*(\([^)]*\)|\w+)\s*=>\s*{?|function\s*\([^)]*\)\s*{?/;
  return functionRegex.test(text);
}

export function buildFunctionTree(list: DocumentSymbol[]) {
  const rootFunctions: DocumentSymbol[] = [];
  const parentStack: DocumentSymbol[] = [];

  list.forEach(node => {
    const functionItem = {
      ...node,
      children: []
    };

    while (
      parentStack.length > 0 &&
      !parentStack[parentStack.length - 1].range.contains(node.range)
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

/** Iterate to get the starting and ending rows for all node areas */
export function getAllNodeStartAndEndRow(node?: IDocumentSymbol[]) {
  if (!node) {
    return [];
  }
  const result: { start: number; end: number }[] = [];
  node.forEach(item => {
    result.push({
      start: item.range.start.line,
      end: item.range.end.line
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
export async function FoldOrUnfoldRangeCode(range: vscode.Range) {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    // Get the range of currently visible rows
    const initialVisibleRanges = editor.visibleRanges.map(
      range => new vscode.Range(range.start, range.end)
    );

    // Execute the command to collapse all the code
    await vscode.commands.executeCommand('editor.unfold', {
      selectionLines: [range.start.line, range.end.line]
    });

    // Get the visible range post-folding
    const foldedVisibleRanges = editor.visibleRanges.map(
      range => new vscode.Range(range.start, range.end)
    );

    const isEqual = foldedVisibleRanges.every((foldedRange, index) => {
      const initialRange = initialVisibleRanges[index];
      return foldedRange.isEqual(initialRange);
    });
    if (isEqual) {
      vscode.commands.executeCommand('editor.fold');
    }
  }
  return null;
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null;

  return function (this: ThisParameterType<T>, ...args: Parameters<T>): void {
    const context = this;

    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}
