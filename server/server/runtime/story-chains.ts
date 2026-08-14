/**
 * @file 历史剧情链数据
 *
 * 14 条预定义历史剧情链，覆盖 1851-1912 关键历史节点。
 * 每条链含线性节点（nextNodeIds 单元素数组，预留 DAG 扩展）。
 * 节点 event 的 chainId/chainNodeId/chainProgress 由 generate-event API 动态注入，
 * 本文件仅维护静态剧情数据，不调 LLM、不入库。
 *
 * effects 数值平衡：属性类（military/economy/politics/people/diplomacy/reputation）±5~15，
 * 资源类（silver/troops/food）按史实量级 ±50~500。
 *
 * 参考：AGENTS.md「数据层变更对 H5/小程序/App 三端透明」+ design.md D3。
 */

import type { StoryChain } from '@/types/game'

export const STORY_CHAINS: readonly StoryChain[] = [
  // ============ 1. 太平天国兴亡（1851-1864，5 节点）============
  {
    chainId: 'tai-ping-tian-guo',
    title: '太平天国兴亡',
    description: '洪秀全于广西金田举旗反清，建号太平天国，十四年兴衰，搅动半壁江山。',
    startYear: 1851,
    endYear: 1864,
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '金田起义',
          description: '广西桂平金田村，洪秀全率拜上帝会众举旗反清，建号太平天国，檄文传遍天下，四方响应。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '请缨率军南征', effects: { military: 8, troops: -200, reputation: 8, diplomacy: 3 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '招募乡勇守土', effects: { military: 4, silver: -150, people: 3 } },
            { id: 'c', label: '观望局势待变', effects: { military: -2, reputation: -4, diplomacy: -2 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: ['node-3'],
        isLastNode: false,
        event: {
          title: '定都天京',
          description: '太平军攻陷江宁，改名天京，定为都城，与清廷隔江对峙，东南半壁为之震动。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '派兵江防固守', effects: { military: 6, troops: -100, reputation: 5 } },
            { id: 'b', label: '遣使议和划江', effects: { diplomacy: 5, politics: 3, reputation: -3 } },
            { id: 'c', label: '坐视其坐大', effects: { diplomacy: -5, people: -3 } }
          ]
        }
      },
      {
        nodeId: 'node-3',
        triggerTurnOffset: 2,
        nextNodeIds: ['node-4'],
        isLastNode: false,
        event: {
          title: '天京事变',
          description: '太平天国诸王内讧，东王杨秀清被杀，北王韦昌辉伏诛，翼王石达开出走，元气大伤。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '趁乱进逼天京', effects: { military: 5, reputation: 8, troops: -80 } },
            { id: 'b', label: '按兵不动观变', effects: { politics: 3, reputation: 2 } },
            { id: 'c', label: '联捻共抗清廷', effects: { diplomacy: 6, reputation: 4 } }
          ]
        }
      },
      {
        nodeId: 'node-4',
        triggerTurnOffset: 3,
        nextNodeIds: ['node-5'],
        isLastNode: false,
        event: {
          title: '安庆失守',
          description: '湘军围攻经年，安庆终告陷落，太平天国西线门户洞开，天京粮道危殆。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '水陆并进规复', effects: { military: 3, reputation: 5, troops: -120 } },
            { id: 'b', label: '收缩防线保天京', effects: { military: -1, people: -3 } },
            { id: 'c', label: '弃城转移江西', effects: { troops: -100, reputation: 2 } }
          ]
        }
      },
      {
        nodeId: 'node-5',
        triggerTurnOffset: 4,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '天京陷落',
          description: '湘军轰塌城墙攻入天京，太平天国覆灭，洪秀全已殁，余众星散，十四年大业终成尘烟。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '论功进剿余孽', effects: { military: 10, reputation: 15, people: 5 } },
            { id: 'b', label: '招抚散众安民', effects: { people: 8, reputation: 6, silver: -100 } },
            { id: 'c', label: '奏报捷音请赏', effects: { politics: 8, reputation: 10 } }
          ]
        }
      }
    ]
  },

  // ============ 2. 第二次鸦片战争（1856-1860，3 节点）============
  {
    chainId: 'er-ci-ya-pian',
    title: '第二次鸦片战争',
    description: '亚罗号事件点燃战火，英法联军北上，焚圆明园，逼签北京条约，国门洞开更深。',
    startYear: 1856,
    endYear: 1860,
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '亚罗号事件',
          description: '广东水师登船捉人，英人以旗号受辱为由兴师问罪，战火再起于南疆。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '强硬拒英要求', effects: { diplomacy: -8, military: 4, reputation: 5 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '道歉息事宁人', effects: { diplomacy: 3, reputation: -5, politics: 2 } },
            { id: 'c', label: '暗调兵勇备防', effects: { military: 5, silver: -120 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: ['node-3'],
        isLastNode: false,
        event: {
          title: '大沽口之战',
          description: '联军舰队猛攻大沽炮台，炮台失守，天津告急，京师震动。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '死守炮台不退', effects: { military: 7, troops: -150, reputation: 8 } },
            { id: 'b', label: '退守津城谈判', effects: { diplomacy: 4, reputation: -4 } },
            { id: 'c', label: '调僧格林沁勤王', effects: { military: 6, troops: -100, reputation: 6 } }
          ]
        }
      },
      {
        nodeId: 'node-3',
        triggerTurnOffset: 2,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '北京条约',
          description: '联军焚毁圆明园，逼清廷签北京条约，增开商埠、割让九龙、准华工出洋，国耻愈深。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '忍辱准约图存', effects: { diplomacy: 6, reputation: -8, people: -5 } },
            { id: 'b', label: '力陈不可签约', effects: { politics: 5, reputation: 6, diplomacy: -4 } },
            { id: 'c', label: '筹办洋务自强', effects: { economy: 6, military: 4, politics: 3 } }
          ]
        }
      }
    ]
  },

  // ============ 3. 捻军之乱（1853-1868，3 节点）============
  {
    chainId: 'nian-jun-zhi-luan',
    title: '捻军之乱',
    description: '皖豫捻众聚散无常，流动作战十余年，赖湘淮诸军合力，方告荡平。',
    startYear: 1853,
    endYear: 1868,
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '捻军起事',
          description: '皖北捻众揭竿，驰骋豫鲁苏皖，劫富济贫，官军剿抚两难。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '分兵堵剿要冲', effects: { military: 6, troops: -120, reputation: 4 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '坚壁清野困之', effects: { people: -4, economy: -5, military: 2 } },
            { id: 'c', label: '招抚捻首归降', effects: { diplomacy: 5, reputation: 3, politics: 2 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: ['node-3'],
        isLastNode: false,
        event: {
          title: '曾国藩督师',
          description: '清廷命曾国藩督办剿捻，划河圈地，欲聚而歼之，捻势稍敛。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '协同湘军布防', effects: { military: 7, reputation: 6, troops: -100 } },
            { id: 'b', label: '建言改剿为防', effects: { politics: 4, military: 2 } },
            { id: 'c', label: '按兵静观其变', effects: { military: -2, reputation: -3 } }
          ]
        }
      },
      {
        nodeId: 'node-3',
        triggerTurnOffset: 2,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '捻军覆灭',
          description: '淮军纵横截击，西捻就歼于徒骇河，东捻亦溃，历时十五年的捻乱终平。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '奏凯论功行赏', effects: { military: 9, reputation: 12, politics: 5 } },
            { id: 'b', label: '安抚降众屯田', effects: { people: 7, reputation: 6, silver: -100 } },
            { id: 'c', label: '裁撤勇营节饷', effects: { economy: 8, military: -4 } }
          ]
        }
      }
    ]
  },

  // ============ 4. 同治回乱（1862-1873，3 节点）============
  {
    chainId: 'tong-zhi-hui-luan',
    title: '同治回乱',
    description: '陕甘回众起事，连年兵燹，左宗棠平定西北，设新疆行省以固边圉。',
    startYear: 1862,
    endYear: 1873,
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '陕甘回乱起',
          description: '陕甘回汉仇杀蔓延，城池屡陷，驿道断绝，西北骚然。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '派兵弹压绥靖', effects: { military: 7, troops: -150, people: -3 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '分化回汉息争', effects: { diplomacy: 5, people: 4, politics: 3 } },
            { id: 'c', label: '闭城自守待援', effects: { military: -3, people: -5 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: ['node-3'],
        isLastNode: false,
        event: {
          title: '左宗棠平乱',
          description: '左宗棠率楚军西征，稳扎稳打，连克坚城，回乱渐息。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '助饷供输楚军', effects: { economy: -6, military: 6, reputation: 7 } },
            { id: 'b', label: '献策屯垦固本', effects: { economy: 5, people: 4, politics: 3 } },
            { id: 'c', label: '按兵观其成效', effects: { reputation: -2, military: -1 } }
          ]
        }
      },
      {
        nodeId: 'node-3',
        triggerTurnOffset: 2,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '收复西北',
          description: '西北底定，清廷设甘肃新疆巡抚，建行省以隶版图，边患暂弭。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '奏请建省安边', effects: { politics: 8, reputation: 12, diplomacy: 4 } },
            { id: 'b', label: '移民实边屯垦', effects: { people: 8, economy: 5, silver: -150 } },
            { id: 'c', label: '留兵镇守要隘', effects: { military: 6, troops: -80, reputation: 5 } }
          ]
        }
      }
    ]
  },

  // ============ 5. 洋务运动（1861-1895，4 节点）============
  {
    chainId: 'yang-wu-yun-dong',
    title: '洋务运动',
    description: '师夷长技以自强，设局造械、练新军、兴学堂，三十年求富求强，终验于甲午。',
    startYear: 1861,
    endYear: 1895,
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '总理衙门设立',
          description: '京师设总理各国事务衙门，专司洋务外交，开近代外交之端。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '积极参与筹办', effects: { diplomacy: 6, politics: 4, economy: 3 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '消极应付了事', effects: { diplomacy: -3, politics: 1 } },
            { id: 'c', label: '上疏扩大事权', effects: { politics: 5, reputation: 3 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: ['node-3'],
        isLastNode: false,
        event: {
          title: '江南制造局',
          description: '李鸿章奏设江南制造局，购机器、造枪炮、译西书，洋务由虚入实。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '斥资入股办厂', effects: { economy: 8, military: 6, silver: -400 } },
            { id: 'b', label: '徐图缓进', effects: { economy: 3, politics: 1 } },
            { id: 'c', label: '力陈糜费当止', effects: { politics: -3, reputation: 3, diplomacy: -2 } }
          ]
        }
      },
      {
        nodeId: 'node-3',
        triggerTurnOffset: 2,
        nextNodeIds: ['node-4'],
        isLastNode: false,
        event: {
          title: '北洋水师成军',
          description: '李鸿章苦心经营，北洋水师成军，舰船称雄东亚，以为海防可恃。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '捐饷添购巨舰', effects: { military: 10, diplomacy: 5, silver: -500 } },
            { id: 'b', label: '维持现有规模', effects: { military: 4, reputation: 2 } },
            { id: 'c', label: '反对穷兵黩武', effects: { politics: 4, economy: 3, military: -2 } }
          ]
        }
      },
      {
        nodeId: 'node-4',
        triggerTurnOffset: 3,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '甲午战败',
          description: '甲午一役，北洋水师全军覆没，洋务三十年求强之梦，毁于一旦。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '痛定思痛整军', effects: { military: 4, reputation: -6, silver: -200 } },
            { id: 'b', label: '主和新起炉灶', effects: { diplomacy: 4, reputation: -8, people: -5 } },
            { id: 'c', label: '上疏变法图存', effects: { politics: 6, reputation: 5 } }
          ]
        }
      }
    ]
  },

  // ============ 6. 左宗棠收复新疆（1865-1878，3 节点）============
  {
    chainId: 'zuo-zong-tang-xin-jiang',
    title: '左宗棠收复新疆',
    description: '阿古柏窃据新疆，俄英觊觎，左宗棠舆榇西征，力撑塞防，终复故土。',
    startYear: 1865,
    endYear: 1878,
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '阿古柏入侵',
          description: '浩罕军官阿古柏趁乱入疆，建伪政权，英俄竞相扶植，西北门户洞开。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '请缨西征讨逆', effects: { military: 8, reputation: 8, troops: -200 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '主张弃疆保海', effects: { diplomacy: -4, military: -2, reputation: -5 } },
            { id: 'c', label: '严守边关待变', effects: { military: 3, troops: -80 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: ['node-3'],
        isLastNode: false,
        event: {
          title: '海防塞防之争',
          description: '朝堂争辩海防与塞防孰重，左宗棠力陈新疆不可弃，获准统筹西征。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '力挺塞防论', effects: { politics: 6, reputation: 7, diplomacy: 3 } },
            { id: 'b', label: '主张海防优先', effects: { military: 3, diplomacy: -2 } },
            { id: 'c', label: '调和两防兼顾', effects: { politics: 4, economy: 2 } }
          ]
        }
      },
      {
        nodeId: 'node-3',
        triggerTurnOffset: 2,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '收复伊犁',
          description: '左宗棠威逼兼外谈判，伊犁终归版图，新疆建省，百年边疆自此奠定。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '筹边建省安民', effects: { politics: 9, reputation: 14, diplomacy: 5 } },
            { id: 'b', label: '移民屯垦实边', effects: { people: 8, economy: 6, silver: -200 } },
            { id: 'c', label: '留重兵镇西域', effects: { military: 7, troops: -120, reputation: 6 } }
          ]
        }
      }
    ]
  },

  // ============ 7. 琉球台湾事件（1871-1874，2 节点）============
  {
    chainId: 'liu-qiu-tai-wan',
    title: '琉球台湾事件',
    description: '琉球漂民遇害，日本借端兴兵犯台，清廷隐忍立约，琉球自此渐亡于日。',
    startYear: 1871,
    endYear: 1874,
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '牡丹社事件',
          description: '琉球漂民在台湾遇害，日本藉口保民，遣兵登陆台湾番地，衅端骤起。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '派兵渡台御侮', effects: { military: 7, troops: -150, reputation: 6 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '遣使诘问日本', effects: { diplomacy: 4, politics: 3, reputation: 2 } },
            { id: 'c', label: '隐忍回避争端', effects: { diplomacy: -3, reputation: -5 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '北京专条',
          description: '清日立约，清廷偿银五十万两，默许日本侵台为"保民义举"，琉球宗主权动摇。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '忍让维系数十年', effects: { diplomacy: 4, reputation: -6, silver: -200 } },
            { id: 'b', label: '力拒条约不成', effects: { politics: 5, reputation: 4, diplomacy: -3 } },
            { id: 'c', label: '密图联琉抗衡', effects: { diplomacy: 3, reputation: 3, politics: 2 } }
          ]
        }
      }
    ]
  },

  // ============ 8. 中法战争（1883-1885，3 节点）============
  {
    chainId: 'zhong-fa-zhan-zheng',
    title: '中法战争',
    description: '法图越南，战端起于中南半岛，马尾败绩而镇南关捷，不败而败，条约损权。',
    startYear: 1883,
    endYear: 1885,
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '越南冲突',
          description: '法军进占越南北圻，迫越王臣服，清廷宗藩关系告急，战和两难。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '出兵保藩固圉', effects: { military: 7, troops: -150, reputation: 6 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '划界罢兵息争', effects: { diplomacy: 5, reputation: -4, politics: 2 } },
            { id: 'c', label: '按兵观衅待机', effects: { military: -2, reputation: -3 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: ['node-3'],
        isLastNode: false,
        event: {
          title: '马尾海战',
          description: '法舰突袭马尾港，福建水师仓促应战，舰船尽毁，东南海防为之崩摧。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '死战御敌雪耻', effects: { military: 6, troops: -180, reputation: 7 } },
            { id: 'b', label: '重整残部设防', effects: { military: 4, reputation: 3, silver: -150 } },
            { id: 'c', label: '奏请速和止损', effects: { diplomacy: 4, reputation: -5 } }
          ]
        }
      },
      {
        nodeId: 'node-3',
        triggerTurnOffset: 2,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '镇南关大捷',
          description: '老将冯子材大破法军于镇南关，克复谅山，然清廷乘胜即收，签约认越属法。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '乘胜规复全越', effects: { military: 8, reputation: 10, troops: -120 } },
            { id: 'b', label: '见好即收立约', effects: { diplomacy: 5, reputation: -6, people: -3 } },
            { id: 'c', label: '奏陈边事善后', effects: { politics: 6, reputation: 5 } }
          ]
        }
      }
    ]
  },

  // ============ 9. 甲午战争（1894-1895，3 节点，前置 yang-wu-yun-dong）============
  {
    chainId: 'jia-wu-zhan-zheng',
    title: '甲午战争',
    description: '朝鲜东学党起事，中日兵戎相见，黄海喋血，马关签约，东亚格局为之一变。',
    startYear: 1894,
    endYear: 1895,
    prerequisiteChainIds: ['yang-wu-yun-dong'],
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '朝鲜东学党',
          description: '朝鲜东学党起事，中日皆出兵，衅端起于半岛，战云密布。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '增兵援朝制日', effects: { military: 7, troops: -200, reputation: 5 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '主张两国撤兵', effects: { diplomacy: 4, reputation: -3 } },
            { id: 'c', label: '按兵静观其变', effects: { military: -3, reputation: -4 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: ['node-3'],
        isLastNode: false,
        event: {
          title: '黄海海战',
          description: '北洋水师与日本联合舰队决战黄海，互有伤亡，制海权渐落敌手。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '决死战保舰队', effects: { military: 8, troops: -250, reputation: 8 } },
            { id: 'b', label: '避战保船港内', effects: { military: -5, reputation: -8 } },
            { id: 'c', label: '巧设伏击邀击', effects: { military: 5, reputation: 4, troops: -100 } }
          ]
        }
      },
      {
        nodeId: 'node-3',
        triggerTurnOffset: 2,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '马关条约',
          description: '清廷战败，签马关条约，割台湾澎湖、赔银二亿两、开商埠，列强瓜分序幕拉开。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '忍痛准约图存', effects: { diplomacy: 5, reputation: -10, silver: -500, people: -8 } },
            { id: 'b', label: '力主迁都再战', effects: { military: 4, reputation: 6, troops: -200 } },
            { id: 'c', label: '联俄法制日谋', effects: { diplomacy: 6, politics: 4, reputation: 3 } }
          ]
        }
      }
    ]
  },

  // ============ 10. 戊戌变法（1898，2 节点）============
  {
    chainId: 'wu-xu-bian-fa',
    title: '戊戌变法',
    description: '康有为梁启超倡维新，光绪下诏更法，百日而败，六君子血溅菜市口。',
    startYear: 1898,
    endYear: 1898,
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '明定国是',
          description: '光绪帝颁《明定国是诏》，倡言变法，裁冗员、兴学堂、练新军，朝野震动。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '上疏赞成新政', effects: { politics: 7, reputation: 6, economy: 4 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '观望骑墙自保', effects: { politics: -2, reputation: -3 } },
            { id: 'c', label: '联旧党阻新政', effects: { politics: 4, reputation: -6 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '戊戌政变',
          description: '慈禧发动政变，囚光绪、杀六君子，新政尽废，维新梦碎，朝局复旧。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '力保新政未果', effects: { politics: 5, reputation: 4, military: -3 } },
            { id: 'b', label: '告退避祸全身', effects: { politics: -1, reputation: -4 } },
            { id: 'c', label: '附后党以自固', effects: { politics: 3, reputation: -8, people: -3 } }
          ]
        }
      }
    ]
  },

  // ============ 11. 义和团运动（1899-1901，3 节点，前置 wu-xu-bian-fa）============
  {
    chainId: 'yi-he-tuan',
    title: '义和团运动',
    description: '义和团"扶清灭洋"蔓延京津，引来八国联军，辛丑签约，国几不国。',
    startYear: 1899,
    endYear: 1901,
    prerequisiteChainIds: ['wu-xu-bian-fa'],
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '义和团兴起',
          description: '义和团起于山东，喊"扶清灭洋"，焚教堂、攻使馆，列强哗然。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '剿抚兼施用之', effects: { military: 4, people: 3, reputation: -3 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '纵团以抗外侮', effects: { reputation: 5, diplomacy: -6, people: 5 } },
            { id: 'c', label: '力主严剿乱民', effects: { politics: 4, reputation: -5, people: -4 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: ['node-3'],
        isLastNode: false,
        event: {
          title: '八国联军',
          description: '八国联军攻陷天津、北京，慈禧挟光绪西逃，京畿惨遭兵燹。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '勤王护驾抗敌', effects: { military: 7, troops: -200, reputation: 9 } },
            { id: 'b', label: '随扈西行进陕', effects: { reputation: -6, politics: 2, diplomacy: 2 } },
            { id: 'c', label: '留守安抚地方', effects: { people: 5, reputation: 4, silver: -150 } }
          ]
        }
      },
      {
        nodeId: 'node-3',
        triggerTurnOffset: 2,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '辛丑条约',
          description: '清廷签辛丑条约，赔款白银四亿五千万两，允使馆区驻兵，主权丧尽。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '忍辱认约救亡', effects: { diplomacy: 5, reputation: -10, silver: -500, people: -8 } },
            { id: 'b', label: '力陈不可签约', effects: { politics: 6, reputation: 5, diplomacy: -4 } },
            { id: 'c', label: '筹款分期摊还', effects: { economy: -8, silver: -300, politics: 3 } }
          ]
        }
      }
    ]
  },

  // ============ 12. 日俄战争（1904-1905，2 节点）============
  {
    chainId: 'ri-e-zhan-zheng',
    title: '日俄战争',
    description: '日俄争锋于东北，清廷宣告中立，战后日本继俄据南满，东北益危。',
    startYear: 1904,
    endYear: 1905,
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '旅顺攻防',
          description: '日俄鏖战旅顺，炮火连天，清廷划辽河以东为战区，坐视国土沦为战场。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '严守中立护民', effects: { diplomacy: 4, people: 4, reputation: 2 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '暗助日军逐俄', effects: { diplomacy: 5, reputation: -4, military: 2 } },
            { id: 'c', label: '联俄制日自保', effects: { diplomacy: -4, reputation: -3 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '朴茨茅斯和约',
          description: '日俄和于朴茨茅斯，俄让南满权益于日，清廷虽收回部分主权，东北已入日俄夹缝。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '乘势收回权益', effects: { diplomacy: 5, politics: 4, reputation: 4 } },
            { id: 'b', label: '隐忍周旋两强', effects: { diplomacy: 3, reputation: -3 } },
            { id: 'c', label: '编练新军备边', effects: { military: 6, troops: -100, silver: -150 } }
          ]
        }
      }
    ]
  },

  // ============ 13. 清末新政（1901-1911，3 节点，前置 yi-he-tuan）============
  {
    chainId: 'qing-mo-xin-zheng',
    title: '清末新政',
    description: '庚子后清廷推行新政，废科举、练新军、预备立宪，然皇族内阁失信，革命遂起。',
    startYear: 1901,
    endYear: 1911,
    prerequisiteChainIds: ['yi-he-tuan'],
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '庚子后变法',
          description: '清廷痛定思痛，下诏变法，废科举、设学堂、奖实业，规模逾戊戌。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '力推新政育才', effects: { politics: 6, economy: 6, reputation: 5 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '敷衍因循旧制', effects: { politics: -3, reputation: -4 } },
            { id: 'c', label: '倡办实业兴利', effects: { economy: 8, reputation: 4, silver: -150 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: ['node-3'],
        isLastNode: false,
        event: {
          title: '立宪运动',
          description: '朝野呼吁立宪，清廷派员考察，颁预备立宪谕，然步伐迟缓，民望渐失。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '请速开国会', effects: { politics: 7, reputation: 6, people: 4 } },
            { id: 'b', label: '缓进筹备立宪', effects: { politics: 3, reputation: 1 } },
            { id: 'c', label: '反对虚宪实专', effects: { reputation: 5, politics: -2 } }
          ]
        }
      },
      {
        nodeId: 'node-3',
        triggerTurnOffset: 2,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '皇族内阁',
          description: '清廷颁皇族内阁，亲贵揽权，立宪派大失所望，人心渐向革命。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '上疏请改组阁', effects: { politics: 5, reputation: 4, people: 3 } },
            { id: 'b', label: '缄默以观后效', effects: { politics: -1, reputation: -3 } },
            { id: 'c', label: '暗结立宪力量', effects: { reputation: 6, politics: 3, diplomacy: 2 } }
          ]
        }
      }
    ]
  },

  // ============ 14. 辛亥革命（1911-1912，3 节点，前置 qing-mo-xin-zheng）============
  {
    chainId: 'xin-hai-ge-ming',
    title: '辛亥革命',
    description: '武昌枪声一响，各省响应，南北议和，清帝退位，两千年帝制终结。',
    startYear: 1911,
    endYear: 1912,
    prerequisiteChainIds: ['qing-mo-xin-zheng'],
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '武昌起义',
          description: '武昌新军发难，各省纷纷独立，清廷急调北洋军南下，局势崩解。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '响应起义独立', effects: { reputation: 10, politics: 8, military: 6 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '按兵静观其变', effects: { military: -3, reputation: -4 } },
            { id: 'c', label: '效忠清廷平乱', effects: { politics: 4, reputation: -8, military: 5 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: ['node-3'],
        isLastNode: false,
        event: {
          title: '南北议和',
          description: '南北代表沪上议和，袁世凯逼宫，清廷与革命党博弈于改朝换代之际。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '促成共和统一', effects: { politics: 8, reputation: 9, people: 6 } },
            { id: 'b', label: '拥袁促成和局', effects: { politics: 5, reputation: 3, military: 2 } },
            { id: 'c', label: '主战到底裂土', effects: { military: 6, reputation: -5, troops: -150 } }
          ]
        }
      },
      {
        nodeId: 'node-3',
        triggerTurnOffset: 2,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '清帝退位',
          description: '宣统帝逊位，清祚终结，两千年帝制落幕，共和肇建，然乱象未已。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '拥护共和新建', effects: { politics: 10, reputation: 12, people: 8 } },
            { id: 'b', label: '遗老缅怀故朝', effects: { reputation: -6, politics: -3 } },
            { id: 'c', label: '整军经武图强', effects: { military: 8, troops: -100, economy: 4 } }
          ]
        }
      }
    ]
  }
]
