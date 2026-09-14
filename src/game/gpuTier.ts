export type GpuTier = 'low' | 'medium' | 'high';

/** GPU string → tier. Mobile families by generation; desktop is high unless software/integrated. */
export function classifyGpu(gpu: string, touch: boolean): GpuTier {
  const g = gpu.toLowerCase();
  if (/swiftshader|llvmpipe|softpipe|microsoft basic/.test(g)) return 'low';
  const adreno = /adreno[^\d]*(\d{3})/.exec(g);
  if (adreno) {
    const n = Number(adreno[1]);
    return n >= 730 ? 'high' : n >= 640 ? 'medium' : 'low';
  }
  const mali = /mali-g(\d{2,3})/.exec(g);
  if (mali) {
    const n = Number(mali[1]);
    // G710/715/720/725/925 flagships; G610/G68/G76–G78 upper mid-range (Dimensity 8x00, Exynos 9xx/1080)
    if (n >= 710) return 'high';
    if (n === 610 || n === 68 || (n >= 76 && n <= 78)) return 'medium';
    return 'low';
  }
  if (/xclipse/.test(g)) return 'medium';
  if (/apple/.test(g)) return touch ? 'medium' : 'high';
  if (/powervr|mali|vivante|videocore/.test(g)) return 'low';
  if (/intel/.test(g)) return /iris xe|arc/.test(g) ? 'high' : 'medium';
  return touch ? 'medium' : 'high';
}

