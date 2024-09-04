import path from 'path';
import Parser, { SyntaxNode } from 'web-tree-sitter';
import * as vscode from 'vscode';
import { ISyntaxNode } from './types/index.type';
import {
  buildFunctionTree,
  FoldOrUnfoldAllCode,
  FoldOrUnfoldRangeCode,
  formatComment,
  getArrowFunctionDefinition
} from './utils';

function parserTypescript(
  document: vscode.TextDocument,
  parser: Parser
): ISyntaxNode[] {
  const tree = parser.parse(document.getText());

  const functionNodes = tree.rootNode.descendantsOfType([
    'function_declaration',
    'arrow_function'
  ]);

  const functionList: ISyntaxNode[] = [];

  functionNodes.forEach(item => {
    let node = item;
    if (item.type === 'arrow_function' && item.parent?.type === 'arguments') {
      return;
    }

    if (item.type === 'arrow_function') {
      node = getArrowFunctionDefinition(item) ?? item;
    }

    const functionComment = tree.rootNode.descendantForPosition({
      row: node.startPosition.row - 1,
      column: node.startPosition.column
    });
    const functionRange = new vscode.Range(
      new vscode.Position(node.startPosition.row, node.startPosition.column),
      new vscode.Position(node.endPosition.row, node.endPosition.column)
    );
    const functionName =
      item.type === 'arrow_function'
        ? item.parent?.firstNamedChild?.text ?? 'no name'
        : item.firstNamedChild?.text ?? 'no name';

    functionList.push({
      name: functionName,
      isFolded: null,
      vscodeRange: functionRange,
      syntaxNode: node,
      comment:
        functionComment.type === 'comment'
          ? formatComment(functionComment.text)
          : ''
    });
  });

  return buildFunctionTree(functionList);
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

  // Jump code location command
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
  // Fold all code command
  const foldCodeCommand = vscode.commands.registerCommand(
    'function-map.foldCode',
    () => {
      FoldOrUnfoldAllCode();
      functionMapProvider.refresh();
    }
  );
  // Unfold all code command
  const unfoldCodeCommand = vscode.commands.registerCommand(
    'function-map.unfoldCode',
    () => {
      FoldOrUnfoldAllCode();
      functionMapProvider.refresh();
    }
  );
  // Fold specified code command
  const foldRangeCodeCommand = vscode.commands.registerCommand(
    'function-map.foldSpecificRange',
    (item: FunctionMapItem) => {
      FoldOrUnfoldRangeCode(item.range, item.children);
    }
  );
  // Unfold specified code command
  const unfoldRangeCodeCommand = vscode.commands.registerCommand(
    'function-map.unfoldSpecificRange',
    (item: FunctionMapItem) => {
      FoldOrUnfoldRangeCode(item.range, item.children);
    }
  );

  let parser: Parser;

  const visibleRangesChangeEvent =
    vscode.window.onDidChangeTextEditorVisibleRanges(() => {
      functionMapProvider.refresh();
    });
  const saveDocumentEvent = vscode.workspace.onDidSaveTextDocument(
    (document: vscode.TextDocument) => {
      const functionTree = parserTypescript(document, parser);
      functionMapProvider.updateFunctionList(functionTree);
    }
  );

  // When the extension is deactivated, all registered commands, event listeners, etc. are automatically cleaned up
  context.subscriptions.push(
    revealRangeCommand,
    foldCodeCommand,
    unfoldCodeCommand,
    foldRangeCodeCommand,
    unfoldRangeCodeCommand,
    visibleRangesChangeEvent,
    saveDocumentEvent
  );

  Parser.init().then(async () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const document = editor.document;
      const languageId = document.languageId;

      const absolute = path.join(
        context.extensionPath,
        'parsers',
        `tree-sitter-${languageId}.wasm`
      );
      const wasm = path.relative(process.cwd(), absolute);

      let functionTree: ISyntaxNode[] = [];
      switch (languageId) {
        case 'typescript':
          const Lang = await Parser.Language.load(wasm);
          parser = new Parser();
          parser.setLanguage(Lang);

          functionTree = parserTypescript(document, parser);
          break;

        default:
          break;
      }

      functionMapProvider.updateFunctionList(functionTree);
    }
  });
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
        item.children,
        item.comment
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
            item.children,
            item.comment
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
    public children?: ISyntaxNode[],
    public description?: string
  ) {
    super(label, collapsibleState);

    this.description = description;
    this.tooltip = description;
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
