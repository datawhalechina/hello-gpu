// Product-level narrative; technical figures stay in generations.json.
export const generationPresentation = {
 tesla: {form:'经典涡轮显卡',subtitle:'并行计算，由此启程。',cooling:'离心风扇把气流导向封闭风道，散热器覆盖 G80 与周围显存。',fan:'离心涡轮风扇',fanText:'径向叶片向风道送风',cooler:'热管与散热鳍片',structure:'G80 的 8 个 TPC，每个包含 2 个 SM；统一流处理器共同承担着色任务。'},
 fermi: {form:'外露鳍片涡轮显卡',subtitle:'为计算，重新构想。',cooling:'外露金属鳍片与涡轮风道组合，散热结构覆盖高功耗 GF100。',fan:'离心涡轮风扇',fanText:'沿整张卡的长度引导气流',cooler:'外露散热鳍片',structure:'完整 GF100 的 4 个 GPC 各含 4 个 SM；GTX 480 启用其中 15 个。'},
 kepler: {form:'阶梯式涡轮显卡',subtitle:'让并行，更进一步。',cooling:'紧凑的涡轮风扇、分层外壳与鳍片散热器共同组成 GTX 680 的风道。',fan:'涡轮风扇',fanText:'单侧风扇推动定向气流',cooler:'鳍片散热器',structure:'GK104 的 4 个 GPC 各含 2 个 SMX，每个 SMX 配置 192 个 CUDA 核心。'},
 maxwell: {form:'金属外框涡轮显卡',subtitle:'让每一瓦，都有力量。',cooling:'银色金属外框、散热窗口与离心风扇，构成 GTX 980 的参考设计外形。',fan:'离心涡轮风扇',fanText:'将气流送过密集散热鳍片',cooler:'热管与散热器',structure:'GM204 的 4 个 GPC 各含 4 个 SMM；每个 SMM 分为 4 组执行分区。'},
 pascal: {form:'多面金属涡轮显卡',subtitle:'每一次计算，更进一步。',cooling:'多面切削外框包围单涡轮风道，均热板将 GPU 热量传向散热鳍片。',fan:'离心涡轮风扇',fanText:'单风扇与封闭风道协同散热',cooler:'均热板与散热鳍片',structure:'完整 GP102 的 6 个 GPC 共含 30 个 SM；GTX 1080 Ti 启用其中 28 个。'},
 volta: {form:'双槽 PCIe 加速卡',subtitle:'矩阵计算，有了专属引擎。',cooling:'黑金外壳包覆扁平卡身。外壳揭开后，依次露出长条散热器、PCB 与 GPU／HBM2 封装。',fan:'黑金整卡外壳',fanText:'连续顶盖与侧板包覆散热器',cooler:'双向风道散热器',structure:'完整 GV100 共含 84 个 SM；V100 PCIe 启用 80 个，每个 SM 首次加入 8 个 Tensor Core。'},
 turing: {form:'双轴流风扇显卡',subtitle:'让实时光线，照进现实。',cooling:'两颗轴流风扇与横贯卡身的鳍片阵列，组成 RTX 2080 Ti FE 的开放式散热结构。',fan:'双轴流风扇',fanText:'从正面推动空气穿过散热器',cooler:'全长鳍片与均热板',structure:'完整 TU102 共含 72 个 SM；RTX 2080 Ti 启用 68 个。每个 SM 加入 1 个 RT Core。'},
 ampere: {form:'双槽 PCIe 加速卡',subtitle:'让数据，更快抵达算力。',cooling:'完整金属外壳形成长条风道。罩壳整体抬起，再分离鳍片与导热底座，进入 GA100 封装。',fan:'PCIe 金属外壳',fanText:'顶盖、侧壁与端部风口形成完整卡身',cooler:'被动风冷散热器',structure:'完整 GA100 共含 128 个 SM；A100 PCIe 启用 108 个。该数据中心 GPU 不配置 RT Core。'},
 hopper: {form:'双槽 PCIe 加速卡',subtitle:'为更大的模型，深入一层。',cooling:'金色外壳、黑色端盖与连续背板包覆 H100。沿着拆解镜头，逐层进入 HBM2e 封装与计算单元。',fan:'H100 整卡外壳',fanText:'完整罩壳包围内部鳍片阵列',cooler:'长条鳍片与导热底座',structure:'完整 GH100 共含 144 个 SM；H100 PCIe 启用 114 个，并引入 Transformer Engine。'},
 ada: {form:'三槽贯穿气流显卡',subtitle:'光影的边界，再次向前。',cooling:'厚实的鳍片阵列与两面风扇配置，让 RTX 4090 FE 的气流穿过散热器两侧。',fan:'贯穿式双风扇',fanText:'两面布置风扇，扩大气流通路',cooler:'厚型鳍片与均热板',structure:'完整 AD102 的 12 个 GPC 共含 144 个 SM；RTX 4090 启用其中 128 个。'},
 blackwell: {form:'双贯穿气流显卡',subtitle:'把想象，推进现实。',cooling:'双贯穿气流、紧凑 PCB 与均热板，在有限空间里协同工作。',fan:'双贯穿气流',fanText:'双风扇与开放式鳍片，让气流贯穿两侧',cooler:'3D 均热板',structure:'完整 GB202 的 12 个 GPC 组织 192 个 SM；RTX 5090 实际启用其中 170 个。'}
};
