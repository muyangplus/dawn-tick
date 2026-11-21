/**
 * Esc / 安卓返回键的「返回上一级」栈：后登记的先处理。
 *
 * 页面一层（非课表页回课表、设置分组回列表、帮助页回来源）登记在 `pageBackStack`；
 * 弹窗里的步骤（如导入流程）登记在各自弹窗的栈里，由弹窗的 Esc 处理先问一遍。
 * 处理函数只在「此时可返回」时登记，所以栈顶就是这一次该退的那一级。
 */
export interface BackStack {
  /** 登记一个返回动作，返回注销函数。 */
  push(handler: () => void): () => void;
  /** 执行栈顶的返回动作；栈空返回 false。 */
  handle(): boolean;
  size(): number;
}

export function createBackStack(): BackStack {
  const handlers: Array<() => void> = [];
  return {
    push(handler) {
      // 包一层，同一函数登记两次也能分别注销
      const entry = (): void => handler();
      handlers.push(entry);
      return () => {
        const index = handlers.lastIndexOf(entry);
        if (index >= 0) handlers.splice(index, 1);
      };
    },
    handle() {
      const top = handlers[handlers.length - 1];
      if (top === undefined) return false;
      top();
      return true;
    },
    size: () => handlers.length,
  };
}

/** 页面层级的返回栈：不在任何弹窗里的组件登记到这里。 */
export const pageBackStack = createBackStack();

/**
 * 最外一级：离开当前页（帮助页回来源、其他页回课表）。页面栈空了才轮到它，
 * 与登记先后无关（React 先跑子组件的 effect，父组件登记的不能靠顺序垫底）。
 */
export const rootBackStack = createBackStack();

/** 页面一层的返回：先页面栈，再最外一级。 */
export function handlePageBack(): boolean {
  return pageBackStack.handle() || rootBackStack.handle();
}
