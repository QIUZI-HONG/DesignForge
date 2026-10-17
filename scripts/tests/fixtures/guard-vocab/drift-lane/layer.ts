/**
 * 违规夹具②（guard-vocab）：lane 词表写成缺项子集字面量（漏了 deliver），
 * 子集也必须经真源派生（filter/sort），不得手抄，必须 exit 1 且点名 LANES。
 */
export const LANES = ['create', 'refine'] as const;
