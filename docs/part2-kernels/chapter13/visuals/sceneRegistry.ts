import type {SceneMeta} from '../../../components/animation/sceneTypes'
export const rmsnormTileMeta:SceneMeta={eyebrow:'Triton · 两行 × 四列的逻辑 tile',title:'同一 program 的两行，怎样各算各的尺度？',viewBox:'0 0 720 440',mobileViewBox:'0 0 400 620',note:'3×3 输入、R=2、B=4 仅用于手算。tile 是逻辑张量，不等于线程排布；动画速度不代表耗时。',steps:[
{label:'读两行',title:'program 0 领取第 0、1 行',narration:'每行只有三列。第四个逻辑位置被列 mask 挡住，提供零贡献；它不会变成一个有效输入。'},
{label:'各行求和',title:'只沿列轴归约',narration:'第 0 行 9+16+0+0=25；第 1 行 1+4+4+0=9。两行的平方和保持独立。'},
{label:'各行尺度',title:'每行都除以有效列数 3',narration:'25/3 与 9/3 分别计算 r。分母不取逻辑宽度 4，也不取一个 program 内的行数 2。'},
{label:'同列权重',title:'同一组权重用于两行',narration:'w=[1,0.5,2] 按列复用，每行用自己的 r。第四列禁止写回，没有第四个输出。'},
{label:'末尾行',title:'program 1 只有一行有效',narration:'第 2 行是存在的全零行：epsilon 让 r 有效，输出仍是三个零。第 3 行不存在，行 mask 禁止它的加载和写回。'}
]}
