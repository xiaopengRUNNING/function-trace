import path from 'path';
import Parser, { SyntaxNode } from 'web-tree-sitter';
import * as vscode from 'vscode';

async function FoldOrUnfoldAllCode() {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    // 获取当前可见的行范围
    const initialVisibleRanges = editor.visibleRanges.map(
      range => new vscode.Range(range.start, range.end)
    );

    // 执行折叠全部代码的命令
    await vscode.commands.executeCommand('editor.foldAll');

    // 获取折叠后的可见范围
    const foldedVisibleRanges = editor.visibleRanges.map(
      range => new vscode.Range(range.start, range.end)
    );

    const isFullyFolded = foldedVisibleRanges.every((foldedRange, index) => {
      const initialRange = initialVisibleRanges[index];
      return foldedRange.isEqual(initialRange);
    });

    if (isFullyFolded) {
      vscode.commands.executeCommand('editor.unfoldAll');
      vscode.commands.executeCommand(
        'setContext',
        'functionMapView.isAllFolded',
        false
      );
    } else {
      vscode.commands.executeCommand('editor.foldAll');
      vscode.commands.executeCommand(
        'setContext',
        'functionMapView.isAllFolded',
        true
      );
    }
  }
}
function FoldOrUnfoldRangeCode(range: vscode.Range) {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const visibleRanges = editor.visibleRanges;

    let isRangeFolded = true;

    for (const visibleRange of visibleRanges) {
      console.log(visibleRange.contains(range));

      if (visibleRange.contains(range)) {
        isRangeFolded = false; // If the target range is within the visible range, it indicates that it is not collapsed.
      }
    }

    editor.selection = new vscode.Selection(range.start, range.end);
    if (isRangeFolded) {
      vscode.commands.executeCommand('editor.unfold');
    } else {
      vscode.commands.executeCommand('editor.fold');
    }
    return !isRangeFolded;
  }
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
    item => {
      const foldedStatus = FoldOrUnfoldRangeCode(item.range);
      item.isFolded = foldedStatus;
      item.updateContextValue();
      functionMapProvider.refresh();
    }
  );
  // Unfold specified code
  const unfoldRangeCode = vscode.commands.registerCommand(
    'function-map.unfoldSpecificRange',
    item => {
      const foldedStatus = FoldOrUnfoldRangeCode(item.range);
      item.isFolded = foldedStatus;
      item.updateContextValue();
      functionMapProvider.refresh();
    }
  );

  const editor = vscode.window.activeTextEditor;
  let functionList: SyntaxNode[] = [];
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

      functionList = tree.rootNode.descendantsOfType([
        'function_declaration',
        'arrow_function'
      ]);
      functionMapProvider.updateFunctionList(functionList);
    })();
  }

  // When the extension is deactivated, all registered commands, event listeners, etc. are automatically cleaned up
  context.subscriptions.push(
    revealRangeCommand,
    foldCodeCommand,
    unfoldCodeCommand,
    foldRangeCode,
    unfoldRangeCode
  );
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

  updateFunctionList(list: SyntaxNode[]) {
    this.data = list.map(item => {
      const functionRange = new vscode.Range(
        new vscode.Position(item.startPosition.row, item.startPosition.column),
        new vscode.Position(item.endPosition.row, item.endPosition.column)
      );

      let isRangeFolded = true;
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const visibleRanges = editor.visibleRanges;

        for (const visibleRange of visibleRanges) {
          if (visibleRange.contains(functionRange)) {
            isRangeFolded = false; // If the target range is within the visible range, it indicates that it is not collapsed.
          }
        }
      }

      if (item.type === 'arrow_function') {
        return new FunctionMapItem(
          item.parent?.firstNamedChild?.text ?? 'no name',
          vscode.TreeItemCollapsibleState.None,
          functionRange,
          isRangeFolded
        );
      }
      return new FunctionMapItem(
        item.firstNamedChild?.text ?? 'no name',
        vscode.TreeItemCollapsibleState.None,
        functionRange,
        isRangeFolded
      );
    });
    this.refresh();
  }

  getTreeItem(element: FunctionMapItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: FunctionMapItem): Thenable<FunctionMapItem[]> {
    if (element === undefined) {
      return Promise.resolve(this.data);
    }
    return Promise.resolve([]);
  }
}

class FunctionMapItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly range: vscode.Range,
    public readonly isFolded: boolean
  ) {
    super(label, collapsibleState);

    this.description = '这是一个Hello World函数1111111111111111111';
    this.tooltip = '这是一个Hello World函数';
    this.contextValue = isFolded ? 'foldedItem' : 'unfoldedItem';
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

  updateContextValue() {
    console.log(this.isFolded);

    this.contextValue = this.isFolded ? 'foldedItem' : 'unfoldedItem';
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
