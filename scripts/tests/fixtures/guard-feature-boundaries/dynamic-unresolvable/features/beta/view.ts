// 阻塞夹具：动态导入目标含插值，静态判不出落点——守卫应 exit 2（阻塞，禁当通过）。
export async function loadAlphaModule(name: string) {
  return import(`@/features/alpha/${name}/mod`);
}
