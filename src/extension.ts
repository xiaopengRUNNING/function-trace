import path from 'path';
import Parser from 'web-tree-sitter';
import * as vscode from 'vscode';
import { IDocumentSymbol } from './types/index.type';
import {
  buildFunctionTree,
  debounce,
  FoldOrUnfoldAllCode,
  FoldOrUnfoldRangeCode,
  formatComment,
  judgeIsFunction,
  judgeIsReactFunction
} from './utils';
import { DocumentSymbol, SymbolKind } from 'vscode';

const languageJudgeFunctionMap: Record<
  string,
  (item: IDocumentSymbol, text: string) => boolean
> = {
  typescript: (item: IDocumentSymbol, text: string) =>
    judgeIsFunction(item, text),
  javascript: (item: IDocumentSymbol, text: string) =>
    judgeIsFunction(item, text),
  typescriptreact: (item: IDocumentSymbol, text: string) =>
    judgeIsReactFunction(item, text),
  javascriptreact: (item: IDocumentSymbol, text: string) =>
    judgeIsReactFunction(item, text)
};

export function activate(context: vscode.ExtensionContext) {
  // Initialize the state of all collapse icon
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
      vscode.commands.executeCommand('function-map.jumpCode', item.range);
      FoldOrUnfoldRangeCode(item.range);
    }
  );
  // Unfold specified code command
  const unfoldRangeCodeCommand = vscode.commands.registerCommand(
    'function-map.unfoldSpecificRange',
    (item: FunctionMapItem) => {
      vscode.commands.executeCommand('function-map.jumpCode', item.range);
      FoldOrUnfoldRangeCode(item.range);
    }
  );

  let parser: Parser;

  const filterFunctionList = (
    tree: DocumentSymbol[],
    doc: vscode.TextDocument
  ) => {
    if (!tree || !tree.length) {
      return [];
    }
    const parserTree = parser.parse(doc.getText());
    const languageId = doc.languageId;
    let result: IDocumentSymbol[] = [];
    let list = [...tree];
    let index = 0;

    while (index <= list.length - 1) {
      const item = list[index];
      if (item.children && item.children.length) {
        list.push(...item.children);
      }

      if (
        languageJudgeFunctionMap[languageId]?.(item, doc.getText(item.range))
      ) {
        const functionComment = parserTree.rootNode.descendantForPosition({
          row: item.range.start.line - 1,
          column: doc.lineAt(item.range.start.line - 1).range.end.character - 1
        });
        result.push({
          ...item,
          comment:
            functionComment.type === 'comment'
              ? formatComment(functionComment.text)
              : ''
        });
      }
      index++;
    }

    return result;
  };

  const functionMapCore = debounce((document: vscode.TextDocument) => {
    if (parser) {
      vscode.commands
        .executeCommand('vscode.executeDocumentSymbolProvider', document.uri)
        .then((value: unknown) => {
          if (value) {
            const symbols = value as DocumentSymbol[];
            const result = filterFunctionList(symbols, document);

            const tree = buildFunctionTree(
              result.sort((a: DocumentSymbol, b: DocumentSymbol) =>
                a.range.start.compareTo(b.range.start)
              )
            );
            functionMapProvider.updateFunctionList(tree);
          }
        });
    }
  }, 500);

  const changeDiagnostics = vscode.languages.onDidChangeDiagnostics(event => {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && event.uris.includes(activeEditor.document.uri)) {
      functionMapCore(activeEditor.document);
    }
  });
  const changeActiveDocument = vscode.window.onDidChangeActiveTextEditor(
    event => {
      if (event?.document) {
        parseCore(event.document);
      } else {
        functionMapProvider.updateFunctionList([]);
      }
    }
  );

  // When the extension is deactivated, all registered commands, event listeners, etc. are automatically cleaned up
  context.subscriptions.push(
    revealRangeCommand,
    foldCodeCommand,
    unfoldCodeCommand,
    foldRangeCodeCommand,
    unfoldRangeCodeCommand,
    changeDiagnostics,
    changeActiveDocument
  );

  Parser.init().then(async () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      parseCore(editor.document);
    }
  });

  async function parseCore(document: vscode.TextDocument) {
    const languageId = document.languageId;
    const absolute = path.join(
      context.extensionPath,
      'parsers',
      `tree-sitter-${languageId}.wasm`
    );
    const wasm = path.relative(process.cwd(), absolute);

    let Lang;
    switch (languageId) {
      case 'typescript':
        Lang = await Parser.Language.load(wasm);
        parser = new Parser();
        parser.setLanguage(Lang);
        break;

      case 'javascript':
        Lang = await Parser.Language.load(wasm);
        parser = new Parser();
        parser.setLanguage(Lang);
        break;

      case 'typescriptreact':
        Lang = await Parser.Language.load(wasm);
        parser = new Parser();
        parser.setLanguage(Lang);
        break;

      default:
        break;
    }
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

  updateFunctionList(list: IDocumentSymbol[]) {
    this.data = list.map(item => {
      return new FunctionMapItem(
        item.name,
        item.children && item.children?.length > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None,
        item.range,
        item.range.isSingleLine,
        item.children,
        item.comment
      );
    });
    this.refresh();
  }

  getTreeItem(element: FunctionMapItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: FunctionMapItem): Thenable<FunctionMapItem[]> {
    if (element?.children && element.children.length > 0) {
      return Promise.resolve(
        element.children.map(item => {
          return new FunctionMapItem(
            item.name,
            item.children && item.children?.length > 0
              ? vscode.TreeItemCollapsibleState.Collapsed
              : vscode.TreeItemCollapsibleState.None,
            item.range,
            item.range.isSingleLine,
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
    public isSingleLine: boolean,
    public children?: IDocumentSymbol[],
    public description?: string
  ) {
    super(label, collapsibleState);

    this.description = description;
    this.tooltip = description;
    this.contextValue = isSingleLine ? 'singleline' : 'foldItem';
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
