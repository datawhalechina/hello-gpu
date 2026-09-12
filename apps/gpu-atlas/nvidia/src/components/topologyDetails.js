const unitNames = { compute:'计算簇', cache:'共享 L2 缓存', memory:'显存控制器', frontend:'PCIe / 命令处理', io:'外围 I/O', cuda:'算术执行通路', tensor:'Tensor Core', rt:'RT Core', scheduler:'Warp 调度与派发', registers:'寄存器文件', shared:'共享存储 / L1', int32:'整数执行资源', fp64:'FP64 双精度', sfu:'特殊函数单元' };
const copy = {
 compute:['COMPUTE CLUSTER','并行计算，成簇发生。','计算簇将多个流式多处理器组织在一起，承接分发的计算任务。每个小方格代表一个计算单元；选择计算簇，继续深入它的组成。'],
 cache:['SHARED L2 CACHE','让数据，靠近计算。','L2 缓存连接计算簇与显存控制器，保存近期访问的数据，减少外部显存读写，并为计算单元提供共享数据通路。'],
 memory:['MEMORY CONTROLLERS','持续供给，每一次运算。','显存控制器协调 GPU 与外部显存之间的数据传输。总线位宽与显存速率共同决定理论带宽，控制器组织随架构和产品配置变化。'],
 frontend:['HOST INTERFACE','把任务，交给并行世界。','主机经 PCI Express 提交任务，命令处理与分发逻辑再将工作送往各个计算簇。图中表达连接关系，不代表接口的实物位置。'],
 io:['PERIPHERAL INTERFACES','连接芯片，连接系统。','外围模块负责主机通信与专用 I/O。显示、媒体和高速互连的配置取决于芯片用途，这里只展示它们的逻辑关系。'],
 cuda:['ARITHMETIC EXECUTION','大量细小运算，同时发生。','线程以 warp 为单位被调度，执行浮点与整数运算。执行资源的数量与组织共同决定吞吐，不能仅凭核心数比较跨代性能。'],
 tensor:['TENSOR CORES','矩阵计算，有专用通路。','Tensor Core 加速矩阵乘加，服务 AI 训练、推理与神经图形。数据格式和峰值吞吐随代际变化，也取决于精度与稀疏性设置。'],
 rt:['RT CORES','为每束光，找到交点。','RT Core 加速 BVH 遍历与光线求交，让通用执行单元可以投入着色与其他计算任务。专用 RT Core 从 Turing 首次引入。'],
 scheduler:['WARP SCHEDULERS','让就绪线程，接续执行。','调度器选择就绪的 warp 并发射指令。当部分线程等待数据时，其他线程可使用执行资源，以隐藏等待延迟。调度器数量不等于每周期指令数。'],
 registers:['REGISTER FILE','把工作值，留在线程身边。','寄存器保存线程执行时正在使用的数据。容量与每个线程的寄存器占用会影响同一个 SM 中可同时驻留的线程数量。'],
 shared:['SHARED MEMORY / L1','在近处，交换数据。','共享存储让同一个线程块内的线程协作。它与 L1 的组织和容量分配随架构变化，并非所有代际都使用同一种统一池。'],
 int32:['INTEGER EXECUTION','整数运算，沿通路流动。','整数执行通路承担地址计算与整数运算。独立资源与共用通路的区别，会影响它与浮点运算的并发方式。'],
 fp64:['DOUBLE PRECISION','为更高精度，保留能力。','FP64 双精度浮点用于需要更高数值精度的计算。消费级与数据中心芯片的双精度吞吐不同，应结合对应白皮书理解。'],
 sfu:['SPECIAL FUNCTION UNITS','复杂函数，专门执行。','特殊函数单元提供部分超越函数和特殊算术指令的执行能力，与通用算术通路配合。具体吞吐规则随架构变化。'],
};
export function getTopologyDetails(gpu,facts,view,selection,group){
 const selected=copy[selection]?selection:view==='chip'?'compute':'cuda';
 let [eyebrow,title,text]=copy[selected];const sm=facts.sm,unit=gpu.smLabel||'SM',cluster=facts.clusterLabel;
 const groupName=`${cluster} ${String(group+1).padStart(2,'0')}`;
 const cache=gpu.id==='tesla'?'纹理缓存':facts.fullL2.includes('未')?'共享 L2 缓存':`共享 L2 缓存（${facts.fullL2}）`;
 const statMap={compute:[`${facts.fullClusters} × ${facts.smPerCluster}`,`${cluster} × ${unit} / 完整 ${gpu.chip}`],cache:[gpu.id==='tesla'?'TEXTURE':facts.fullL2.includes('未')?'L2':facts.fullL2,gpu.id==='tesla'?'专用纹理缓存路径':`完整 ${gpu.chip} / L2 缓存`],memory:[gpu.memoryType,'所选产品的显存技术'],frontend:['PCIe','CPU ↔ GPU / 主机接口'],io:['I/O','外围接口与专用功能'],cuda:[String(sm.cores),`${gpu.coreLabel||'CUDA 核心'} / 单个 ${unit}`],tensor:[String(sm.tensor),`Tensor Core / 单个 ${unit}`],rt:[String(sm.rt),`RT Core / 单个 ${unit}`],scheduler:[`${sm.schedulers} / ${sm.dispatch}`,`调度器 / 派发单元 · 单个 ${unit}`],registers:[sm.registers.split(' · ')[0],`寄存器文件 / 单个 ${unit}`],shared:[sm.shared.match(/[\d /]+\sKB/)?.[0]?.trim()||'SHARED',`共享存储 / 单个 ${unit}`],int32:['INT32',`整数执行资源 / ${unit}`],fp64:[typeof sm.fp64==='number'?String(sm.fp64):'FP64',`双精度执行资源 / ${unit}`],sfu:[typeof sm.sfu==='number'?String(sm.sfu):'SFU',`特殊函数资源 / ${unit}`]};
 const rows={
  compute:[['当前选中',groupName],[`${unit} 数量`,facts.smPerCluster],['主要功能',/HBM/.test(gpu.memoryType)?'AI / 科学计算 / 通用计算':gpu.rtGeneration?'图形计算 / 通用计算 / 光线追踪':'图形计算 / 通用并行计算'],['片上缓存',cache],['互连结构','片上数据互连']],
  cache:[['当前选中',gpu.id==='tesla'?'纹理缓存':'共享 L2'],['完整芯片',facts.fullL2],['所选显卡',facts.l2],['连接对象',`${cluster} / 显存控制器`],['主要用途','数据复用 / 减少访存等待']],
  memory:[['当前选中','显存控制器'],['产品接口',facts.memoryInterface.split(' · ')[0]],['显存容量',gpu.memory],['理论带宽',`${gpu.bandwidth.toLocaleString('en-US')} GB/s`],['连接对象','片上缓存 / 外部显存']],
  frontend:[['主要用途','主机通信 / 工作分发'],['下游模块',`${cluster} 计算簇`],['产品形态','PCIe 显卡']],io:[['代表芯片',gpu.chip],['产品类别',gpu.category],['互连类型','以对应产品资料为准']],
  cuda:[['浮点资源',`${sm.cores} ${gpu.id==='tesla'?'SP':'FP32'}`],['整数组织',sm.int32],['线程组织','32 线程 / warp']],
  tensor:[['硬件代际',`第 ${gpu.tensorGeneration} 代`],['单元数量',`${sm.tensor} 个 / ${unit}`],['主要用途','矩阵乘加 / AI 加速']],rt:[['硬件代际',`第 ${gpu.rtGeneration} 代`],['主要用途','BVH 遍历 / 光线求交'],['协作单元','可编程着色单元']],
  scheduler:[['调度器',sm.schedulers],['派发单元',sm.dispatch],['线程束大小','32 线程']],registers:[['资源配置',sm.registers],['访问范围','线程私有'],['主要用途','操作数 / 中间结果']],shared:[['共享存储',sm.shared],['L1 组织',sm.l1],['主要用途','线程块内数据协作']],int32:[['执行组织',sm.int32],['数据类型','32 位整数'],['主要用途','地址计算 / 整数运算']],fp64:[['资源配置',typeof sm.fp64==='number'?`${sm.fp64} 个`:sm.fp64],['主要用途','高精度数值计算']],sfu:[['资源配置',String(sm.sfu)],['访存单元',String(sm.loadStore)]]
 };
 if(selected==='compute')text=gpu.id==='tesla'?'G80 把顶点、像素与几何着色工作汇入统一的流处理器。多个 SM 组成 TPC，让同一套资源处理不同类型的着色任务。':`${cluster} 将多个 ${unit} 组织在一起，承接分发的计算任务。每个小方格代表一个 ${unit}；选择计算簇，可以查看其组成并继续深入。`;
 if(selected==='cache'&&gpu.id==='tesla'){eyebrow='TEXTURE CACHE';text='G80 的纹理访问走专用缓存路径。这里合并示意分布式纹理缓存，不代表后续架构使用的全芯片统一 L2。';}
 let detailRows=rows[selected];if(!detailRows.some(([k])=>k==='当前选中'))detailRows=[['当前选中',unitNames[selected]],...detailRows];
 return {eyebrow,title,text,stat:statMap[selected][0],statLabel:statMap[selected][1],rows:[['所属架构',`${gpu.name} (${gpu.chip})`],...detailRows]};
}
