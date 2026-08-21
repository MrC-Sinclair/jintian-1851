/**
 * @file 预置兜底事件池
 *
 * 60 条事件，覆盖 5 类型各 12 条（民生/军事/外交/随机/历史剧情）。
 * 当 LLM generate-event 失败时从池中随机返回，保证回合不阻断。
 *
 * 每条事件含 title/description/options(2-4)/effects（effects 数值 ±3~15 平衡）。
 * 兜底事件**不携带** chainId 字段（独立事件，不进入剧情链）。
 */

import type { GameEvent, EventType } from '@/types/game'

interface FallbackEvent extends GameEvent {
  /** 用于按类型筛选，与 GameEvent.eventType 一致（不含 'npc'） */
  type: Exclude<EventType, 'npc'>
}

export const FALLBACK_EVENTS: readonly FallbackEvent[] = [
  // ========== 民生（12 条）==========
  {
    type: '民生',
    title: '粮价飞涨',
    description: '入夏以来连月不雨，江南粮价较往年涨了三倍，百姓怨声载道，城隍庙前每日都有饥民聚集。',
    eventType: '民生',
    options: [
      { id: 'a', label: '开仓放粮赈济灾民', effects: { people: 10, silver: -200, food: -50 } },
      { id: 'b', label: '强令米商平价售粮', effects: { people: 4, economy: -8, reputation: 3 } },
      { id: 'c', label: '置之不理', effects: { people: -12, reputation: -8 } }
    ]
  },
  {
    type: '民生',
    title: '瘟疫蔓延',
    description: '乡间时疫蔓延，已染者数百人，邻县开始拒绝接纳本县商旅，事态若不遏制恐酿大祸。',
    eventType: '民生',
    options: [
      { id: 'a', label: '重金延请名医施药', effects: { people: 8, silver: -150, reputation: 5 } },
      { id: 'b', label: '封锁疫区断绝交通', effects: { people: -3, economy: -6, diplomacy: -4 } },
      { id: 'c', label: '上书朝廷请求赈灾', effects: { people: 3, politics: 2, reputation: 2 } }
    ]
  },
  {
    type: '民生',
    title: '水利失修',
    description: '去年大水冲毁堤坝多处，至今未修，今年汛期将至，若不抢修恐淹良田万顷。',
    eventType: '民生',
    options: [
      { id: 'a', label: '征调民夫抢修堤坝', effects: { people: 5, silver: -100, food: -20 } },
      { id: 'b', label: '向富户募捐修堤', effects: { economy: -5, people: 4, reputation: 4 } },
      { id: 'c', label: '听天由命', effects: { people: -8, economy: -10 } }
    ]
  },
  {
    type: '民生',
    title: '科举风波',
    description: '本届乡试有人举报考官受贿泄露考题，士子群情激愤，于学台衙门前跪求公正。',
    eventType: '民生',
    options: [
      { id: 'a', label: '严查重办以正视听', effects: { politics: 6, people: 4, reputation: 6 } },
      { id: 'b', label: '息事宁人压下举报', effects: { politics: -5, reputation: -8 } },
      { id: 'c', label: '上奏朝廷派员复查', effects: { politics: 3, diplomacy: 2 } }
    ]
  },
  {
    type: '民生',
    title: '灾荒乞赈',
    description: '黄河决口，赤地千里，流民载道，扶老携幼涌入邻封，饿殍横陈于道。',
    eventType: '民生',
    options: [
      { id: 'a', label: '设粥厂广施赈济', effects: { people: 12, silver: -250, reputation: 8 } },
      { id: 'b', label: '劝富户捐米平粜', effects: { economy: -4, people: 6, reputation: 4 } },
      { id: 'c', label: '遣返原籍自生自灭', effects: { people: -10, reputation: -6 } }
    ]
  },
  {
    type: '民生',
    title: '矿监苛敛',
    description: '朝廷派矿监四处开矿抽税，爪牙横行乡里，强占民田，民怨沸腾几欲生变。',
    eventType: '民生',
    options: [
      { id: 'a', label: '上疏请罢矿监', effects: { politics: 5, people: 6, reputation: 5 } },
      { id: 'b', label: '暗中庇护乡民', effects: { people: 4, reputation: 3, diplomacy: -2 } },
      { id: 'c', label: '迎合上意助抽', effects: { economy: 6, reputation: -8, people: -6 } }
    ]
  },
  {
    type: '民生',
    title: '漕运阻滞',
    description: '运河淤浅，漕粮北运受阻，京师大仓告急，漕丁聚众鼓噪，沿途米价腾贵。',
    eventType: '民生',
    options: [
      { id: 'a', label: '捐资疏浚河道', effects: { economy: -6, people: 5, reputation: 4 } },
      { id: 'b', label: '改海运以济京仓', effects: { economy: 4, diplomacy: 3, reputation: 3 } },
      { id: 'c', label: '坐视漕运瘫痪', effects: { economy: -5, people: -4 } }
    ]
  },
  {
    type: '民生',
    title: '烟毒泛滥',
    description: '鸦片流毒日广，白银外流，兵弱民疲，街巷烟馆林立，有识者痛心疾首。',
    eventType: '民生',
    options: [
      { id: 'a', label: '雷厉禁烟查缉', effects: { people: 7, reputation: 6, silver: -80 } },
      { id: 'b', label: '弛禁以抽土税', effects: { economy: 6, people: -8, reputation: -6 } },
      { id: 'c', label: '听之任之', effects: { people: -6, reputation: -4 } }
    ]
  },
  {
    type: '民生',
    title: '流民入城',
    description: '连年灾荒，大批流民涌入省城，露宿街衢，盗贼渐起，地方官衙疲于弹压。',
    eventType: '民生',
    options: [
      { id: 'a', label: '设棚安置给米', effects: { people: 9, silver: -150, reputation: 5 } },
      { id: 'b', label: '遣返原籍以靖城', effects: { people: -5, reputation: -3, politics: 2 } },
      { id: 'c', label: '编流民为夫役', effects: { economy: 4, people: 2, reputation: 2 } }
    ]
  },
  {
    type: '民生',
    title: '盐引积弊',
    description: '盐政积弊已久，官盐滞销私盐横行，盐课亏短，盐商勾结官吏，民食贵盐。',
    eventType: '民生',
    options: [
      { id: 'a', label: '整顿盐政革弊', effects: { economy: 7, politics: 4, reputation: 4 } },
      { id: 'b', label: '维持旧制妥协', effects: { economy: 2, reputation: -2 } },
      { id: 'c', label: '加价摊派补亏', effects: { economy: 3, people: -7, reputation: -5 } }
    ]
  },
  {
    type: '民生',
    title: '饥民抢米',
    description: '米铺囤积居奇，饥民聚众数百抢米，市井骚然，衙役弹压反激起更大民愤。',
    eventType: '民生',
    options: [
      { id: 'a', label: '平粜安抚众心', effects: { people: 8, silver: -100, reputation: 5 } },
      { id: 'b', label: '捕拿抢米首犯', effects: { people: -6, reputation: -4, politics: 2 } },
      { id: 'c', label: '密令开仓济急', effects: { people: 10, silver: -120, reputation: 7 } }
    ]
  },
  {
    type: '民生',
    title: '义仓亏空',
    description: '地方义仓本备荒年，不料历年亏空，仓廪空虚，今遇灾荒竟无以为继，乡绅哗然。',
    eventType: '民生',
    options: [
      { id: 'a', label: '筹款补足义仓', effects: { economy: -5, people: 6, reputation: 5 } },
      { id: 'b', label: '追查亏空主事', effects: { politics: 5, reputation: 4, people: 3 } },
      { id: 'c', label: '瞒报亏空拖过', effects: { reputation: -6, politics: -3 } }
    ]
  },

  // ========== 军事（12 条）==========
  {
    type: '军事',
    title: '兵饷拖欠',
    description: '营中兵饷已拖欠三月，士卒私语怨望，有哗变之虞，参将请示速速处置。',
    eventType: '军事',
    options: [
      { id: 'a', label: '搜刮府库补发兵饷', effects: { military: 8, silver: -300, economy: -5 } },
      { id: 'b', label: '向商人借饷许以利权', effects: { military: 5, economy: -4, diplomacy: -2 } },
      { id: 'c', label: '拖延敷衍', effects: { military: -10, people: -3 } }
    ]
  },
  {
    type: '军事',
    title: '匪患骤起',
    description: '境内山贼据险为巢，劫掠商旅，近日竟敢攻打巡检司，伤兵十余人。',
    eventType: '军事',
    options: [
      { id: 'a', label: '亲率精兵进剿', effects: { military: 6, troops: -50, reputation: 7 } },
      { id: 'b', label: '招安抚遣散从贼', effects: { military: -2, people: 3, silver: -80 } },
      { id: 'c', label: '请邻县会剿', effects: { military: 3, diplomacy: -3, reputation: 2 } }
    ]
  },
  {
    type: '军事',
    title: '新军操练',
    description: '新募之军已编练三月，统带请示是否购置洋枪洋操，以图战力精进。',
    eventType: '军事',
    options: [
      { id: 'a', label: '斥重金购洋械练洋操', effects: { military: 12, silver: -400, diplomacy: 2 } },
      { id: 'b', label: '沿用旧制操练弓马', effects: { military: 2, reputation: 3 } },
      { id: 'c', label: '暂缓待来年再议', effects: { military: -1 } }
    ]
  },
  {
    type: '军事',
    title: '边警频传',
    description: '北边游牧部落近日频频犯边，掳掠人畜，守将请示是否出塞追击。',
    eventType: '军事',
    options: [
      { id: 'a', label: '出塞追击立威', effects: { military: 8, troops: -80, silver: -100 } },
      { id: 'b', label: '坚壁清野固守', effects: { military: -2, people: -3, economy: -4 } },
      { id: 'c', label: '遣使通好互市', effects: { military: -3, diplomacy: 8, silver: 50 } }
    ]
  },
  {
    type: '军事',
    title: '裁汰绿营',
    description: '朝廷议裁绿营老弱兵额以节饷，营中人心惶惶，恐生哗变，督抚进退两难。',
    eventType: '军事',
    options: [
      { id: 'a', label: '稳妥裁汰老弱', effects: { military: 2, economy: 6, reputation: 3 } },
      { id: 'b', label: '暂缓裁撤安抚', effects: { military: 4, economy: -3, reputation: 2 } },
      { id: 'c', label: '强行裁撤激变', effects: { military: -6, reputation: -5, troops: -30 } }
    ]
  },
  {
    type: '军事',
    title: '招募勇营',
    description: '地方匪患未靖，官绅筹饷招募勇营团练，以补绿营之不足，声势渐壮。',
    eventType: '军事',
    options: [
      { id: 'a', label: '大力支持办团练', effects: { military: 7, silver: -200, reputation: 4 } },
      { id: 'b', label: '限制勇营规模', effects: { military: 2, economy: -2 } },
      { id: 'c', label: '奏请官督民办', effects: { politics: 4, military: 4, reputation: 3 } }
    ]
  },
  {
    type: '军事',
    title: '军械舞弊',
    description: '军械局采买火药枪支舞弊，以次充好，器械劣质，前线将士性命悬于一线。',
    eventType: '军事',
    options: [
      { id: 'a', label: '严查军械贪腐', effects: { politics: 6, military: 4, reputation: 5 } },
      { id: 'b', label: '姑息了事掩过', effects: { military: -5, reputation: -4 } },
      { id: 'c', label: '另设局自造军火', effects: { military: 6, silver: -250, economy: 3 } }
    ]
  },
  {
    type: '军事',
    title: '海防告警',
    description: '沿海炮台年久失修，火炮锈钝，敌舰游弋外洋，海防告警，守臣亟请修筑。',
    eventType: '军事',
    options: [
      { id: 'a', label: '拨款修筑炮台', effects: { military: 7, silver: -300, diplomacy: 2 } },
      { id: 'b', label: '添购铁甲战舰', effects: { military: 10, silver: -500, diplomacy: 4 } },
      { id: 'c', label: '暂以旧台敷衍', effects: { military: -4, reputation: -3 } }
    ]
  },
  {
    type: '军事',
    title: '平叛凯旋',
    description: '连年剿抚，地方叛乱终告平定，将士凯旋，百姓夹道，然府库为之一空。',
    eventType: '军事',
    options: [
      { id: 'a', label: '论功行赏安军心', effects: { military: 8, reputation: 9, silver: -150 } },
      { id: 'b', label: '乘胜裁勇节饷', effects: { economy: 6, military: -2, reputation: 2 } },
      { id: 'c', label: '奏捷邀功请赏', effects: { politics: 6, reputation: 7 } }
    ]
  },
  {
    type: '军事',
    title: '马政废弛',
    description: '战马匮乏，马政废弛，骑兵不振，遇警无以为恃，将弁屡请整顿牧政。',
    eventType: '军事',
    options: [
      { id: 'a', label: '设牧监广蓄战马', effects: { military: 6, silver: -120, reputation: 2 } },
      { id: 'b', label: '购马于蒙疆', effects: { military: 5, silver: -100, diplomacy: 3 } },
      { id: 'c', label: '因循旧弊不治', effects: { military: -3, reputation: -2 } }
    ]
  },
  {
    type: '军事',
    title: '兵变哗溃',
    description: '客军因欠饷哗变，夜半抢掠街市，民众惊窜，地方秩序几近崩溃。',
    eventType: '军事',
    options: [
      { id: 'a', label: '恩威并施弹压', effects: { military: 5, troops: -40, reputation: 4 } },
      { id: 'b', label: '补饷以安军心', effects: { military: 6, silver: -200, reputation: 3 } },
      { id: 'c', label: '纵兵劫掠不问', effects: { military: 2, people: -10, reputation: -8 } }
    ]
  },
  {
    type: '军事',
    title: '筑垒备战',
    description: '边境衅端将起，朝廷命筑垒屯兵，严阵以待，民夫征调，沿途骚动。',
    eventType: '军事',
    options: [
      { id: 'a', label: '积极筑垒布防', effects: { military: 8, troops: -150, people: -3 } },
      { id: 'b', label: '虚张声势敷衍', effects: { military: -2, reputation: -3 } },
      { id: 'c', label: '请增兵协防', effects: { military: 6, troops: -100, silver: -120 } }
    ]
  },

  // ========== 外交（12 条）==========
  {
    type: '外交',
    title: '列强施压',
    description: '西洋某国公使照会，要求开放本埠为通商口岸，否则将派舰船示威。',
    eventType: '外交',
    options: [
      { id: 'a', label: '妥协开放通商', effects: { diplomacy: 5, economy: 6, people: -8, reputation: -6 } },
      { id: 'b', label: '坚拒并整军备', effects: { diplomacy: -8, military: 4, people: 5 } },
      { id: 'c', label: '拖延周旋谈判', effects: { diplomacy: -2, politics: 3, economy: -2 } }
    ]
  },
  {
    type: '外交',
    title: '邻省求援',
    description: '邻省巡抚遣使求援，言其地遭捻军攻陷三县，请借兵三千并粮草万石。',
    eventType: '外交',
    options: [
      { id: 'a', label: '倾力相助', effects: { diplomacy: 10, troops: -300, food: -100, reputation: 6 } },
      { id: 'b', label: '婉拒仅赠粮千石', effects: { diplomacy: 3, food: -30 } },
      { id: 'c', label: '坐视不理', effects: { diplomacy: -8, reputation: -5 } }
    ]
  },
  {
    type: '外交',
    title: '朝贡使节',
    description: '朝鲜国王遣使赍表入贡，并请兵援其内乱，事涉宗藩体制，须速定夺。',
    eventType: '外交',
    options: [
      { id: 'a', label: '准其入贡并派兵援', effects: { diplomacy: 8, military: -4, troops: -100, reputation: 7 } },
      { id: 'b', label: '受贡却婉拒出兵', effects: { diplomacy: 2, reputation: 2, economy: 3 } },
      { id: 'c', label: '拒贡断绝往来', effects: { diplomacy: -10, reputation: -6, people: -2 } }
    ]
  },
  {
    type: '外交',
    title: '教案冲突',
    description: '乡民与教堂起冲突，焚毁教堂一座，洋人公使要求赔银五万两并严惩凶手。',
    eventType: '外交',
    options: [
      { id: 'a', label: '赔银惩凶息事', effects: { diplomacy: 4, silver: -500, people: -8, reputation: -5 } },
      { id: 'b', label: '据理力争减半赔', effects: { diplomacy: 0, silver: -250, politics: 4 } },
      { id: 'c', label: '拒赔力挺乡民', effects: { diplomacy: -10, people: 8, reputation: 5 } }
    ]
  },
  {
    type: '外交',
    title: '租界扩张',
    description: '列强以保商为名，要求扩展租界，侵夺城外膏腴之地，民情汹汹。',
    eventType: '外交',
    options: [
      { id: 'a', label: '力拒租界扩张', effects: { diplomacy: -6, people: 7, reputation: 6 } },
      { id: 'b', label: '小幅让步了事', effects: { diplomacy: 4, people: -5, reputation: -4 } },
      { id: 'c', label: '周旋拖待时机', effects: { diplomacy: 1, politics: 3, reputation: 2 } }
    ]
  },
  {
    type: '外交',
    title: '关税交涉',
    description: '洋商以协定关税为由，贩运洋货倾销，本土产业凋敝，朝野吁请改税则。',
    eventType: '外交',
    options: [
      { id: 'a', label: '据约力争加税', effects: { diplomacy: -4, economy: 5, reputation: 4 } },
      { id: 'b', label: '维持协定税则', effects: { economy: -3, diplomacy: 3, reputation: -2 } },
      { id: 'c', label: '设局劝用国货', effects: { economy: 4, people: 3, reputation: 3 } }
    ]
  },
  {
    type: '外交',
    title: '边界划界',
    description: '与北邻划界交涉，勘界官争一隘口不决，边民互不相让，几酿械斗。',
    eventType: '外交',
    options: [
      { id: 'a', label: '据理力争隘口', effects: { diplomacy: 5, reputation: 5, military: 2 } },
      { id: 'b', label: '互让以安边境', effects: { diplomacy: 6, people: 3, reputation: 2 } },
      { id: 'c', label: '陈兵边界施压', effects: { military: 5, diplomacy: -4, troops: -80 } }
    ]
  },
  {
    type: '外交',
    title: '遣使出洋',
    description: '朝廷遣使团出洋考察政法工商，开眼看世界，归国者多倡变法自强之说。',
    eventType: '外交',
    options: [
      { id: 'a', label: '资助使团广考察', effects: { diplomacy: 6, politics: 5, economy: 3, silver: -200 } },
      { id: 'b', label: '限制使团权限', effects: { diplomacy: 2, politics: 1 } },
      { id: 'c', label: '力主闭目塞听', effects: { diplomacy: -3, politics: -2, reputation: -3 } }
    ]
  },
  {
    type: '外交',
    title: '传教深入',
    description: '洋教士持条约深入内地传教，民教杂处，猜嫌日深，教堂日增而讼端亦繁。',
    eventType: '外交',
    options: [
      { id: 'a', label: '持平断案息讼', effects: { diplomacy: 4, people: 3, reputation: 3 } },
      { id: 'b', label: '限制教士内迁', effects: { diplomacy: -5, people: 5, reputation: 4 } },
      { id: 'c', label: '纵容排教泄愤', effects: { people: 6, diplomacy: -8, reputation: -5 } }
    ]
  },
  {
    type: '外交',
    title: '借款筑路',
    description: '洋行愿贷巨款修筑铁路，然路权抵押，利权旁落，朝堂争论不休。',
    eventType: '外交',
    options: [
      { id: 'a', label: '借洋款自筑路', effects: { economy: 8, diplomacy: 4, silver: 200 } },
      { id: 'b', label: '拒借款保路权', effects: { economy: -3, diplomacy: -3, reputation: 4 } },
      { id: 'c', label: '官督商办铁路', effects: { economy: 6, politics: 4, silver: -200 } }
    ]
  },
  {
    type: '外交',
    title: '领事裁判',
    description: '列强据条约行领事裁判权，华洋讼案判罚两歧，法权受损，有司束手。',
    eventType: '外交',
    options: [
      { id: 'a', label: '力争法权收回', effects: { diplomacy: -4, politics: 5, reputation: 5 } },
      { id: 'b', label: '妥协商办华案', effects: { diplomacy: 3, reputation: 1, politics: 2 } },
      { id: 'c', label: '默认现状苟安', effects: { diplomacy: 1, reputation: -4, people: -3 } }
    ]
  },
  {
    type: '外交',
    title: '国际调停',
    description: '两国接壤生衅，请第三国居间调停，使节穿梭，条款暗藏利薮。',
    eventType: '外交',
    options: [
      { id: 'a', label: '借调停弭兵端', effects: { diplomacy: 7, reputation: 4, military: 2 } },
      { id: 'b', label: '拒调停自主断', effects: { diplomacy: -3, military: 4, reputation: 3 } },
      { id: 'c', label: '联他国制强邻', effects: { diplomacy: 5, politics: 3, military: 3 } }
    ]
  },

  // ========== 随机（12 条）==========
  {
    type: '随机',
    title: '异星坠落',
    description: '夜半有流星坠于城外，形如巨石，乡民惊传为天降祥瑞或凶兆，纷议不已。',
    eventType: '随机',
    options: [
      { id: 'a', label: '设坛祭祀以安民心', effects: { people: 4, silver: -50, reputation: 3 } },
      { id: 'b', label: '召术士占卜吉凶', effects: { people: 2, politics: -2, reputation: -2 } },
      { id: 'c', label: '不闻不问', effects: { people: -1 } }
    ]
  },
  {
    type: '随机',
    title: '商人献宝',
    description: '有胡商献夜明珠一颗，云价值连城，欲换取通商特权，珠光莹莹确实罕见。',
    eventType: '随机',
    options: [
      { id: 'a', label: '纳珠许其通商', effects: { economy: 8, diplomacy: 3, reputation: -2 } },
      { id: 'b', label: '纳珠不予特权', effects: { economy: 2, silver: 200, reputation: -3 } },
      { id: 'c', label: '却珠遣之', effects: { reputation: 5, economy: -2 } }
    ]
  },
  {
    type: '随机',
    title: '故人相访',
    description: '昔日同窗故人远道相访，谈及天下大势，言辞间颇有游说之意。',
    eventType: '随机',
    options: [
      { id: 'a', label: '虚心纳言厚礼相待', effects: { politics: 5, diplomacy: 3, silver: -50 } },
      { id: 'b', label: '客套寒暄送客', effects: { politics: 1 } },
      { id: 'c', label: '避而不见', effects: { reputation: -3, diplomacy: -2 } }
    ]
  },
  {
    type: '随机',
    title: '奇书现世',
    description: '书坊有人售卖泰西奇书，言其中载有格致之学、机器之巧，读之令人大开眼界。',
    eventType: '随机',
    options: [
      { id: 'a', label: '购之延人研习', effects: { politics: 6, economy: 3, silver: -100, reputation: 4 } },
      { id: 'b', label: '禁绝此书流传', effects: { politics: -3, people: -4, reputation: 2 } },
      { id: 'c', label: '听其自然', effects: { politics: 1, economy: 1 } }
    ]
  },
  {
    type: '随机',
    title: '江湖卖艺',
    description: '江湖艺人携奇禽异兽献技于市，吞刀吐火，观者如堵，童叟踊跃，市井喧腾。',
    eventType: '随机',
    options: [
      { id: 'a', label: '赏钱助兴开怀', effects: { people: 4, silver: -30, reputation: 2 } },
      { id: 'b', label: '禁演以靖地方', effects: { people: -3, reputation: -1 } },
      { id: 'c', label: '延入府中献艺', effects: { reputation: 3, silver: -50, people: 2 } }
    ]
  },
  {
    type: '随机',
    title: '仙人赐药',
    description: '有道人云游至此，赐丹药一丸云能祛病延年，争购者众，真伪难辨。',
    eventType: '随机',
    options: [
      { id: 'a', label: '试药济民施惠', effects: { people: 5, reputation: 4, silver: -40 } },
      { id: 'b', label: '禁售伪药安民', effects: { people: 3, reputation: 3, politics: 1 } },
      { id: 'c', label: '不问真伪逐之', effects: { reputation: -1, people: -2 } }
    ]
  },
  {
    type: '随机',
    title: '古墓现世',
    description: '乡民施工掘出古墓一座，陪葬珍宝甚多，哄传地下有金，围观者日众。',
    eventType: '随机',
    options: [
      { id: 'a', label: '封存上报有司', effects: { politics: 4, economy: 3, reputation: 4 } },
      { id: 'b', label: '私取珍宝入囊', effects: { silver: 300, reputation: -6, politics: -3 } },
      { id: 'c', label: '招民掘宝分润', effects: { economy: 5, people: 4, reputation: -4 } }
    ]
  },
  {
    type: '随机',
    title: '异域来客',
    description: '金发碧眼的西洋商队抵埠，携钟表火器诸奇物，市民围观如堵，议论纷纷。',
    eventType: '随机',
    options: [
      { id: 'a', label: '优礼相待通商事', effects: { diplomacy: 5, economy: 4, reputation: 3 } },
      { id: 'b', label: '限制其活动', effects: { diplomacy: -2, people: 2, reputation: 1 } },
      { id: 'c', label: '购其奇物仿制', effects: { economy: 4, silver: -100, military: 2 } }
    ]
  },
  {
    type: '随机',
    title: '童谣谶语',
    description: '市井流传一首童谣，暗藏谶语，言将易代鼎革，人心浮动，有司欲禁不能。',
    eventType: '随机',
    options: [
      { id: 'a', label: '晓谕安民心', effects: { people: 3, reputation: 2, politics: 1 } },
      { id: 'b', label: '严查造谣者', effects: { politics: 3, people: -2, reputation: 1 } },
      { id: 'c', label: '置之一笑', effects: { reputation: -1 } }
    ]
  },
  {
    type: '随机',
    title: '祥瑞现世',
    description: '地方奏报境内现嘉禾、白鹿之祥，朝野议论是真祥瑞还是粉饰太平。',
    eventType: '随机',
    options: [
      { id: 'a', label: '上表庆贺邀宠', effects: { politics: 5, reputation: 4, people: 2 } },
      { id: 'b', label: '奏实情免粉饰', effects: { politics: 3, reputation: 3, people: 1 } },
      { id: 'c', label: '冷处理不张扬', effects: { reputation: 1 } }
    ]
  },
  {
    type: '随机',
    title: '海市蜃楼',
    description: '海上忽现蜃楼，城郭楼台隐约可见，万人空巷争睹，传为海神显灵。',
    eventType: '随机',
    options: [
      { id: 'a', label: '设祭谢海神', effects: { people: 4, reputation: 3, silver: -40 } },
      { id: 'b', label: '晓以物理安众', effects: { people: 2, politics: 2, reputation: 2 } },
      { id: 'c', label: '不以为意', effects: { people: -1 } }
    ]
  },
  {
    type: '随机',
    title: '义犬救主',
    description: '传闻有义犬于火中救主，传为美谈，里巷争颂，官吏欲表其门以彰风化。',
    eventType: '随机',
    options: [
      { id: 'a', label: '表其门彰风化', effects: { people: 3, reputation: 4, politics: 1 } },
      { id: 'b', label: '一笑置之', effects: { reputation: -1 } },
      { id: 'c', label: '作训诫喻百姓', effects: { people: 2, reputation: 2 } }
    ]
  },

  // ========== 历史剧情（12 条，独立兜底事件，不携带 chainId）==========
  {
    type: '历史剧情',
    title: '金田起义',
    description: '广西桂平金田村，洪秀全率拜上帝会众举旗反清，建号太平天国，檄文传遍天下。',
    eventType: '历史剧情',
    options: [
      { id: 'a', label: '请缨率军南征', effects: { military: 8, troops: -200, reputation: 8, diplomacy: 3 } },
      { id: 'b', label: '招募乡勇守土', effects: { military: 4, silver: -150, people: 3 } },
      { id: 'c', label: '观望局势待变', effects: { military: -2, reputation: -4, diplomacy: -2 } }
    ]
  },
  {
    type: '历史剧情',
    title: '英法联军',
    description: '英法联军攻陷天津，进逼京师，咸丰帝欲北狩热河，朝廷上下乱作一团。',
    eventType: '历史剧情',
    options: [
      { id: 'a', label: '勤王护驾力战洋人', effects: { military: 6, troops: -300, reputation: 10, diplomacy: -5 } },
      { id: 'b', label: '随驾北狩热河', effects: { reputation: -6, politics: 2, diplomacy: 2 } },
      { id: 'c', label: '留守观望局势', effects: { politics: -3, reputation: -5 } }
    ]
  },
  {
    type: '历史剧情',
    title: '洋务兴起',
    description: '朝廷下诏兴办洋务，于各省设机器局、造船厂，鼓励制器、练兵、兴学。',
    eventType: '历史剧情',
    options: [
      { id: 'a', label: '积极响应创办局厂', effects: { economy: 8, military: 6, silver: -400, politics: 4 } },
      { id: 'b', label: '从缓徐图之', effects: { economy: 2, politics: 1 } },
      { id: 'c', label: '上疏反对', effects: { politics: -3, reputation: 3, diplomacy: -2 } }
    ]
  },
  {
    type: '历史剧情',
    title: '甲午风云',
    description: '日本挑衅朝鲜，北洋水师与日舰激战黄海，胜负未分而朝野震动。',
    eventType: '历史剧情',
    options: [
      { id: 'a', label: '增援北洋决死战', effects: { military: 5, troops: -400, silver: -200, reputation: 6 } },
      { id: 'b', label: '主和议退让求全', effects: { military: -5, diplomacy: 3, people: -6, reputation: -8 } },
      { id: 'c', label: '调停斡旋', effects: { diplomacy: 5, politics: 3, military: -2 } }
    ]
  },
  {
    type: '历史剧情',
    title: '天津教案',
    description: '天津民众因迷拐疑云围攻教堂，毙洋人多名，列强兵舰驶津，衅端大起。',
    eventType: '历史剧情',
    options: [
      { id: 'a', label: '力查真相持平办', effects: { diplomacy: 3, people: 4, reputation: 2 } },
      { id: 'b', label: '屈从洋压惩民', effects: { diplomacy: 4, people: -8, reputation: -8 } },
      { id: 'c', label: '激民抗教泄愤', effects: { people: 7, diplomacy: -10, reputation: 4 } }
    ]
  },
  {
    type: '历史剧情',
    title: '中法交锋',
    description: '法舰突入马尾，福建水师仓促应战，舰船尽毁，东南海防为之崩摧。',
    eventType: '历史剧情',
    options: [
      { id: 'a', label: '死战御敌雪耻', effects: { military: 6, troops: -180, reputation: 7 } },
      { id: 'b', label: '重整残部设防', effects: { military: 4, reputation: 3, silver: -150 } },
      { id: 'c', label: '奏请速和止损', effects: { diplomacy: 4, reputation: -5 } }
    ]
  },
  {
    type: '历史剧情',
    title: '台湾建省',
    description: '朝廷准台湾建省，筹办海防、开山抚番，东南门户自此设专圻以重其事。',
    eventType: '历史剧情',
    options: [
      { id: 'a', label: '大力支持筹防', effects: { military: 6, diplomacy: 3, silver: -200 } },
      { id: 'b', label: '徐图渐进', effects: { military: 2, economy: 2, reputation: 2 } },
      { id: 'c', label: '以费绌为难', effects: { economy: 2, reputation: -2 } }
    ]
  },
  {
    type: '历史剧情',
    title: '戊戌风潮',
    description: '维新诏书频下，裁冗员、兴学堂、练新军，朝野震荡，旧党侧目而新政方兴。',
    eventType: '历史剧情',
    options: [
      { id: 'a', label: '赞成新政推行', effects: { politics: 7, reputation: 6, economy: 4 } },
      { id: 'b', label: '观望骑墙自保', effects: { politics: -2, reputation: -3 } },
      { id: 'c', label: '联旧党阻新政', effects: { politics: 4, reputation: -6 } }
    ]
  },
  {
    type: '历史剧情',
    title: '辛丑议和',
    description: '八国联军退兵，议和条款沉重，赔款巨万、使馆驻兵，国势益危。',
    eventType: '历史剧情',
    options: [
      { id: 'a', label: '忍辱认约救亡', effects: { diplomacy: 5, reputation: -9, silver: -500, people: -7 } },
      { id: 'b', label: '力陈不可签约', effects: { politics: 6, reputation: 5, diplomacy: -4 } },
      { id: 'c', label: '筹款分期摊还', effects: { economy: -8, silver: -300, politics: 3 } }
    ]
  },
  {
    type: '历史剧情',
    title: '日俄战云',
    description: '日俄陈兵东北，战火将燃，清廷划区中立，边民惊惶，国土沦为列强战场。',
    eventType: '历史剧情',
    options: [
      { id: 'a', label: '严守中立护民', effects: { diplomacy: 4, people: 4, reputation: 2 } },
      { id: 'b', label: '暗助日军逐俄', effects: { diplomacy: 5, reputation: -4, military: 2 } },
      { id: 'c', label: '联俄制日自保', effects: { diplomacy: -4, reputation: -3 } }
    ]
  },
  {
    type: '历史剧情',
    title: '立宪呼声',
    description: '各省咨议局相继设立，立宪呼声日高，清廷颁预备立宪谕，然步伐迟缓。',
    eventType: '历史剧情',
    options: [
      { id: 'a', label: '请速开国会', effects: { politics: 7, reputation: 6, people: 4 } },
      { id: 'b', label: '缓进筹备立宪', effects: { politics: 3, reputation: 1 } },
      { id: 'c', label: '反对虚宪实专', effects: { reputation: 5, politics: -2 } }
    ]
  },
  {
    type: '历史剧情',
    title: '武昌枪声',
    description: '武昌新军发难，星火燎原，各省纷纷响应，帝制将倾，天下大势为之骤变。',
    eventType: '历史剧情',
    options: [
      { id: 'a', label: '响应起义独立', effects: { reputation: 10, politics: 8, military: 6 } },
      { id: 'b', label: '按兵静观其变', effects: { military: -3, reputation: -4 } },
      { id: 'c', label: '效忠清廷平乱', effects: { politics: 4, reputation: -8, military: 5 } }
    ]
  }
] as const

/**
 * 从兜底事件池中随机返回一条
 * @param type 指定类型时从该类型中随机，未指定则全池随机
 */
export function getRandomFallbackEvent(type?: Exclude<EventType, 'npc'>): GameEvent {
  const pool = type ? FALLBACK_EVENTS.filter((e) => e.type === type) : FALLBACK_EVENTS
  const actualPool = pool.length > 0 ? pool : FALLBACK_EVENTS
  const idx = Math.floor(Math.random() * actualPool.length)
  // 剔除 type 字段，返回纯 GameEvent
  const { type: _omit, ...event } = actualPool[idx]
  return event
}
