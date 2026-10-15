/**
 * 领域错误：命令栈与场景操作以**可判别**的错误码失败，便于上层（Inspector/Toast）分类提示，
 * 也便于事务回滚路径上做断言（P6 错误分类的挂点在引擎侧先立好）。
 */

/** 错误码（新增时同步文档注释）。 */
export type DomainErrorCode =
  /** 页面不存在。 */
  | 'page-not-found'
  /** 节点不存在。 */
  | 'node-not-found'
  /** 目标不是容器。 */
  | 'not-a-container'
  /** 目标不是实例。 */
  | 'not-an-instance'
  /** 目标不是主组件。 */
  | 'not-a-component'
  /** id 重复。 */
  | 'duplicate-id'
  /** 会形成环的父子操作。 */
  | 'cycle'
  /** 文档至少需要一个页面。 */
  | 'last-page'
  /** 参数非法。 */
  | 'invalid-argument'
  /** 命令类型未注册。 */
  | 'unknown-command'
  /** 令牌解析失败（环/缺失）。 */
  | 'token-error';

/** 领域错误。 */
export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

/** 构造领域错误。 */
export function domainError(code: DomainErrorCode, message: string): DomainError {
  return new DomainError(code, message);
}

/** 判别领域错误。 */
export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
