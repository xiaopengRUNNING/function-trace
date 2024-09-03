import path from 'path';
import Parser, { SyntaxNode } from 'web-tree-sitter';
import * as vscode from 'vscode';
import { ISyntaxNode } from './types/index.type';

/** Check if it is a child */
function isChildOf(parent: ISyntaxNode, child: ISyntaxNode) {
  return (
    child.syntaxNode.startIndex >= parent.syntaxNode.startIndex &&
    child.syntaxNode.endIndex <= parent.syntaxNode.endIndex
  );
}
/** Generate a Tree Structure */
function buildFunctionTree(list: ISyntaxNode[]) {
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
function getAllNodeStartAndEndRow(node?: ISyntaxNode[]) {
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
async function FoldOrUnfoldAllCode() {
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
function FoldOrUnfoldRangeCode(range: vscode.Range, children?: ISyntaxNode[]) {
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

export function activate(context: vscode.ExtensionContext) {
  // 初始化全部折叠图标状态
  vscode.commands.executeCommand(
    'setContext',
    'functionMapView.isAllFolded',
    false
  );

  const functionMapProvider = new FunctionMapProvider();
  vscode.window.registerTreeDataProvider(
    'functionMapView',
    functionMapProvider
  );
  vscode.window.registerWebviewViewProvider(
    'functionMapPreview',
    new FunctionMapPreviewProvider(context)
  );

  // Jump code location
  const revealRangeCommand = vscode.commands.registerCommand(
    'function-map.jumpCode',
    (range: vscode.Range) => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
      }
    }
  );
  // Fold all code
  const foldCodeCommand = vscode.commands.registerCommand(
    'function-map.foldCode',
    () => {
      FoldOrUnfoldAllCode();
      functionMapProvider.refresh();
    }
  );
  // Unfold all Code
  const unfoldCodeCommand = vscode.commands.registerCommand(
    'function-map.unfoldCode',
    () => {
      FoldOrUnfoldAllCode();
      functionMapProvider.refresh();
    }
  );
  // Fold specified code
  const foldRangeCode = vscode.commands.registerCommand(
    'function-map.foldSpecificRange',
    (item: FunctionMapItem) => {
      FoldOrUnfoldRangeCode(item.range, item.children);
    }
  );
  // Unfold specified code
  const unfoldRangeCode = vscode.commands.registerCommand(
    'function-map.unfoldSpecificRange',
    (item: FunctionMapItem) => {
      FoldOrUnfoldRangeCode(item.range, item.children);
    }
  );

  // When the extension is deactivated, all registered commands, event listeners, etc. are automatically cleaned up
  context.subscriptions.push(
    revealRangeCommand,
    foldCodeCommand,
    unfoldCodeCommand,
    foldRangeCode,
    unfoldRangeCode
  );

  vscode.window.onDidChangeTextEditorVisibleRanges(() => {
    functionMapProvider.refresh();
  });

  const editor = vscode.window.activeTextEditor;
  let functionList: ISyntaxNode[] = [];
  if (editor) {
    const document = editor.document;
    const languageId = document.languageId;
    const sourceCode = document.getText();

    (async () => {
      const absolute = path.join(
        context.extensionPath,
        'parsers',
        `tree-sitter-${languageId}.wasm`
      );
      const wasm = path.relative(process.cwd(), absolute);

      await Parser.init();
      const parser = new Parser();
      const Lang = await Parser.Language.load(wasm);
      parser.setLanguage(Lang);
      const tree = parser.parse(sourceCode);

      const visibleRanges = editor.visibleRanges;

      functionList = tree.rootNode
        .descendantsOfType(['function_declaration', 'arrow_function'])
        .map(item => {
          const functionRange = new vscode.Range(
            new vscode.Position(
              item.startPosition.row,
              item.startPosition.column
            ),
            new vscode.Position(item.endPosition.row, item.endPosition.column)
          );
          const name =
            item.type === 'arrow_function'
              ? item.parent?.firstNamedChild?.text ?? 'no name'
              : item.firstNamedChild?.text ?? 'no name';

          return {
            name,
            isFolded: null,
            vscodeRange: functionRange,
            syntaxNode: item
          };
        });

      functionMapProvider.updateFunctionList(
        buildFunctionTree(functionList).map(item => {
          let isFolded = null;
          if (
            item.syntaxNode.startPosition.row !==
            item.syntaxNode.endPosition.row
          ) {
            isFolded = true;
            for (const visibleRange of visibleRanges) {
              if (visibleRange.contains(item.vscodeRange)) {
                isFolded = false; // If the target range is within the visible range, it indicates that it is not collapsed.
              }
            }
          }
          return { ...item, isFolded };
        })
      );
    })();
  }
}

// This method is called when your extension is deactivated
export function deactivate() {
  console.log('deactivate-deactivate-deactivate-deactivate');
}

class FunctionMapProvider implements vscode.TreeDataProvider<FunctionMapItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    FunctionMapItem | undefined | null | void
  > = new vscode.EventEmitter<FunctionMapItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    FunctionMapItem | null | undefined | void
  > = this._onDidChangeTreeData.event;

  private data: FunctionMapItem[] = [];

  constructor() {}

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  updateFunctionList(list: ISyntaxNode[]) {
    this.data = list.map(item => {
      return new FunctionMapItem(
        item.name,
        item.children && item.children?.length > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None,
        item.vscodeRange,
        item.isFolded,
        item.children
      );
    });
    this.refresh();
  }

  getTreeItem(element: FunctionMapItem): vscode.TreeItem {
    const visibleRanges = vscode.window.activeTextEditor?.visibleRanges;

    let isFolded = null;
    if (element.range.start.line !== element.range.end.line && visibleRanges) {
      isFolded = true;
      for (const visibleRange of visibleRanges) {
        if (visibleRange.contains(element.range)) {
          isFolded = false; // If the target range is within the visible range, it indicates that it is not collapsed.
        }
      }
    }

    element.updateContextValue(isFolded);

    return element;
  }

  getChildren(element?: FunctionMapItem): Thenable<FunctionMapItem[]> {
    if (element?.children && element.children.length > 0) {
      const visibleRanges = vscode.window.activeTextEditor?.visibleRanges;

      return Promise.resolve(
        element.children.map(item => {
          let isFolded = null;
          if (
            item.syntaxNode.startPosition.row !==
            item.syntaxNode.endPosition.row
          ) {
            isFolded = true;
            if (visibleRanges) {
              for (const visibleRange of visibleRanges) {
                if (visibleRange.contains(item.vscodeRange)) {
                  isFolded = false; // If the target range is within the visible range, it indicates that it is not collapsed.
                }
              }
            }
          }

          return new FunctionMapItem(
            item.name,
            item.children && item.children?.length > 0
              ? vscode.TreeItemCollapsibleState.Collapsed
              : vscode.TreeItemCollapsibleState.None,
            item.vscodeRange,
            isFolded,
            item.children
          );
        })
      );
    }
    return Promise.resolve(this.data);
  }
}

class FunctionMapItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly range: vscode.Range,
    public isFolded: boolean | null,
    public children?: ISyntaxNode[]
  ) {
    super(label, collapsibleState);

    this.description = '这是一个Hello World函数1111111111111111111';
    this.tooltip = '这是一个Hello World函数';
    this.contextValue = this.formatFoldStatus(this.isFolded);
    this.children = children;
    this.command = {
      command: 'function-map.jumpCode',
      title: 'Jump code',
      arguments: [this.range]
    };
  }

  iconPath = {
    light: path.join(__filename, '..', '..', 'media', 'light', 'svg.svg'),
    dark: path.join(__filename, '..', '..', 'media', 'dark', 'svg.svg')
  };

  formatFoldStatus(isFolded: boolean | null) {
    return isFolded === null
      ? 'singleline'
      : isFolded
      ? 'foldedItem'
      : 'unfoldedItem';
  }

  updateContextValue(isFolded: boolean | null) {
    this.contextValue = this.formatFoldStatus(isFolded);
  }
}

class FunctionMapPreviewProvider implements vscode.WebviewViewProvider {
  context: vscode.ExtensionContext;
  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  public static readonly viewType = 'functionMapPreview';

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ): Thenable<void> | void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    const editor = vscode.window.activeTextEditor;

    if (editor) {
      const document = editor.document;
      const content = document.getText();

      webviewView.webview.html = content;
    } else {
      webviewView.webview.html =
        '开发vscode 插件时，如何读取当前打开的文件内容';
    }
  }
}
