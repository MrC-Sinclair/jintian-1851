/**
 * @file 历史剧情链数据
 *
 * 23 条预定义历史剧情链，覆盖 1851-1912 关键历史节点。
 * 每条链含线性节点（nextNodeIds 单元素数组，预留 DAG 扩展）。
 * 节点 event 的 chainId/chainNodeId/chainProgress 由 generate-event API 动态注入，
 * 本文件仅维护静态剧情数据，不调 LLM、不入库。
 *
 * 数组顺序**不是**触发顺序：generate-event 按 `startYear >= 当前年` 取最早一条可触发链，
 * 同年份按 chainId 定序。下方编号只是分组可读性，新增链一律追加在表尾。
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

  // ============ 6. 左宗棠收复新疆（1865-1884，4 节点）============
  {
    chainId: 'zuo-zong-tang-xin-jiang',
    title: '左宗棠收复新疆',
    description: '阿古柏窃据新疆，俄英觊觎，左宗棠舆榇西征，力撑塞防，终复故土。',
    startYear: 1865,
    endYear: 1884,
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
        nextNodeIds: ['node-4'],
        isLastNode: false,
        event: {
          title: '收复伊犁',
          description: '使臣改约，伊犁终归版图，然边界与偿费仍有损失，西北全局待以建置而定。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '筹边改约保疆土', effects: { politics: 9, reputation: 14, diplomacy: 5 }, nextChainNodeId: 'node-4' },
            { id: 'b', label: '移民屯垦实边', effects: { people: 8, economy: 6, silver: -200 } },
            { id: 'c', label: '留重兵镇西域', effects: { military: 7, troops: -120, reputation: 6 } }
          ]
        }
      },
      {
        nodeId: 'node-4',
        triggerTurnOffset: 3,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '新疆建省',
          description: '关内既安，督臣疏请行省，朝廷准设新疆省、置巡抚，军府旧制自此改为与内地一体之郡县。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '请即建省固边防', effects: { politics: 7, military: 4, reputation: 5, silver: -200 } },
            { id: 'b', label: '先治屯政徐议建置', effects: { economy: 5, food: 200, politics: 2 } },
            { id: 'c', label: '仍循军府旧制', effects: { military: 3, politics: -4, reputation: -3 } }
          ]
        }
      }
    ]
  },

  // ============ 7. 琉球台湾事件（1871-1885，4 节点）============
  {
    chainId: 'liu-qiu-tai-wan',
    title: '琉球台湾事件',
    description: '琉球漂民遇害，日本借端兴兵犯台，清廷隐忍立约，琉球自此渐亡，台湾亦因之建省。',
    startYear: 1871,
    endYear: 1885,
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
        nextNodeIds: ['node-3'],
        isLastNode: false,
        event: {
          title: '北京专条',
          description: '清日立约，清廷偿银五十万两，默许日本侵台为"保民义举"，琉球宗主权动摇。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '忍让维系数十年', effects: { diplomacy: 4, reputation: -6, silver: -200 }, nextChainNodeId: 'node-3' },
            { id: 'b', label: '力拒条约不成', effects: { politics: 5, reputation: 4, diplomacy: -3 } },
            { id: 'c', label: '密图联琉抗衡', effects: { diplomacy: 3, reputation: 3, politics: 2 } }
          ]
        }
      },
      {
        nodeId: 'node-3',
        triggerTurnOffset: 2,
        nextNodeIds: ['node-4'],
        isLastNode: false,
        event: {
          title: '废琉置县',
          description: '日本强制迁琉球王，废琉球藩置冲绳县；清廷与日使争论存祀，分球之议数易其稿终未成。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '力诘日使争存祀', effects: { diplomacy: -4, politics: 4, reputation: 5 }, nextChainNodeId: 'node-4' },
            { id: 'b', label: '用延宕策缓其谋', effects: { diplomacy: 5, politics: 3, reputation: -3 } },
            { id: 'c', label: '置为缓图不深争', effects: { politics: 2, reputation: -4, silver: 150 } }
          ]
        }
      },
      {
        nodeId: 'node-4',
        triggerTurnOffset: 3,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '台湾建省',
          description: '法役既罢，清廷以台湾远隔海疆、为外人所注目，准建省份，简首任巡抚，清赋抚番、铁路炮台次第兴办。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '简任贤员首开帅府', effects: { politics: 6, reputation: 5, silver: -200 } },
            { id: 'b', label: '清赋抚番以固疆本', effects: { economy: 5, military: 3, people: 3 } },
            { id: 'c', label: '缓议建省以节经费', effects: { economy: 3, politics: -3, reputation: -2, silver: 200 } }
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
  },

  // ============ 15. 轮船招商局与电矿商股（1872-1883，3 节点，前置 yang-wu-yun-dong）============
  // 与第 5 条洋务链刻意分工：那条讲军工厂局与海军，这条讲民用商股与市面，节点文案须显地区别。
  {
    chainId: 'min-yong-gong-shang',
    title: '民用工矿与商股',
    description: '军工厂局之外，轮船、电报、煤铁次第集股兴办，官督商办收回利权，然市面投机亦随之而起。',
    startYear: 1872,
    endYear: 1883,
    prerequisiteChainIds: ['yang-wu-yun-dong'],
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '轮船招商局',
          description: '集华商股金创轮船招商局，官督商办，收江海漕运之利以敌洋商，开风气之先。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '集股创办官督商办', effects: { economy: 7, politics: 4, reputation: 4, silver: -200 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '奏拨帑项官款独办', effects: { economy: 4, politics: 6, silver: -300 } },
            { id: 'c', label: '任洋商专其利', effects: { economy: -4, diplomacy: 3, reputation: -3 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: ['node-3'],
        isLastNode: false,
        event: {
          title: '电线与开平矿务',
          description: '津沪电报线路成，开平矿局采煤，运煤铁路继筑，风水顽固之论与利便实用之争并进。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '展设电线以通军报', effects: { economy: 5, military: 4, diplomacy: 2, silver: -250 }, nextChainNodeId: 'node-3' },
            { id: 'b', label: '招集华股开采煤铁', effects: { economy: 6, people: 2, silver: -150 } },
            { id: 'c', label: '以电线有碍风水而止', effects: { economy: -3, people: 3, politics: -2 } }
          ]
        }
      },
      {
        nodeId: 'node-3',
        triggerTurnOffset: 2,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '上海倒款风潮',
          description: '边警日急，房产丝茶投机顿败，钱庄倒账、商号关闭，市面几坏，商办事业大受牵累。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '拨官款持平周转', effects: { economy: 6, politics: 3, reputation: 5, silver: -300 } },
            { id: 'b', label: '任其倒闭以儆取巧', effects: { economy: -5, people: -3, politics: 2 } },
            { id: 'c', label: '严究舞弊商董', effects: { politics: 5, economy: 2, reputation: 3, silver: -80 } }
          ]
        }
      }
    ]
  },

  // ============ 16. 同光接替（1874-1877，3 节点，前置 tong-zhi-hui-luan）============
  {
    chainId: 'tong-zhi-guang-xu',
    title: '同光接替',
    description: '同治帝崩而无嗣，醇邸之子入承大统，两宫垂帘训政，帝师进讲暗长后来党议之根。',
    startYear: 1874,
    endYear: 1877,
    prerequisiteChainIds: ['tong-zhi-hui-luan'],
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '同治帝崩',
          description: '帝崩于养心殿，年甫十九，尚无子嗣，神器虚悬，礼臣拘于家法，中外望择统甚切。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '速议迎立以安社稷', effects: { politics: 6, reputation: 4, silver: -100 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '疏请简择贤长', effects: { politics: 4, reputation: 3, diplomacy: -3 } },
            { id: 'c', label: '观望不言坐视其定', effects: { reputation: -4, politics: -2 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: ['node-3'],
        isLastNode: false,
        event: {
          title: '光绪即位',
          description: '幼帝入承大统，改元光绪，两宫皇太后垂帘听政，枢臣与内廷之分由此而定。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '整饬衙门以应新政', effects: { politics: 6, people: 3, silver: -120 }, nextChainNodeId: 'node-3' },
            { id: 'b', label: '结援醇邸以固根本', effects: { politics: 4, diplomacy: 3, reputation: -3 } },
            { id: 'c', label: '守静待时不预枢要', effects: { economy: 2, reputation: -2 } }
          ]
        }
      },
      {
        nodeId: 'node-3',
        triggerTurnOffset: 2,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '帝师进讲',
          description: '师傅入侍讲幄，经史之外渐及洋务经济，新君左右渐成一班，后来党议之萌实基于此。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '延请名儒主讲', effects: { politics: 3, reputation: 4, economy: 2 } },
            { id: 'b', label: '兼课天文算学', effects: { politics: 4, economy: 3, diplomacy: 2, silver: -100 } },
            { id: 'c', label: '一切循旧例举行', effects: { politics: -2, reputation: -2, economy: 4 } }
          ]
        }
      }
    ]
  },

  // ============ 17. 滇案与烟台条约（1875-1876，2 节点，前置 er-ci-ya-pian）============
  {
    chainId: 'yan-tai-tiao-yue',
    title: '滇案与烟台条约',
    description: '英人入滇被戕，藉端要挟，烟台一约开四口、许游藏，并遣使英谢罪，中国驻使之始。',
    startYear: 1875,
    endYear: 1876,
    prerequisiteChainIds: ['er-ci-ya-pian'],
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '马嘉理案',
          description: '英员马嘉理自滇边被戕，英使威妥玛藉口索赔，语涉决裂，译署与滇督章奏往返争辩。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '缉凶赔款以全邦交', effects: { diplomacy: 5, politics: -3, reputation: -3, silver: -150 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '严诘英人擅入边地', effects: { diplomacy: -5, military: 2, reputation: 5 } },
            { id: 'c', label: '缓议托词查办', effects: { diplomacy: -2, politics: 2, reputation: -2 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '烟台条约',
          description: '议成于烟台：开宜昌芜湖温州北海四口，许英人游历西藏，且派使臣往英国谢罪，遣使出洋自此为常。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '签约换约以免兵祸', effects: { diplomacy: 6, economy: 3, reputation: -5, silver: -100 } },
            { id: 'b', label: '力争裁去入藏一条', effects: { diplomacy: -3, politics: 5, reputation: 4 } },
            { id: 'c', label: '借约促办洋务自强', effects: { economy: 5, military: 3, politics: 2, silver: -200 } }
          ]
        }
      }
    ]
  },

  // ============ 18. 丁戊奇荒（1876-1878，3 节点）============
  // 全盘唯一以粮草为主轴的剧情链：#3/#5 之后粮草与兵员两条惩罚近乎休眠，缺口在此类内容而非数值。
  {
    chainId: 'ding-wu-qi-huang',
    title: '丁戊奇荒',
    description: '晋陕连年大旱，赤地千里，斗米千钱，饿殍载道，各省筹赈捐纳并行，百年奇荒数见。',
    startYear: 1876,
    endYear: 1878,
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '晋陕赤地',
          description: '两年不雨，井泉告涸，粮价腾贵，饥民扶老携幼四出，州县报灾章奏交驰于道。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '捐廉劝募急筹赈', effects: { people: 6, reputation: 5, silver: -300 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '奏请截留漕粮', effects: { people: 4, politics: 3, diplomacy: -3, food: -200 } },
            { id: 'c', label: '讳灾不报以避处分', effects: { people: -8, reputation: -6, politics: 2 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: ['node-3'],
        isLastNode: false,
        event: {
          title: '易子而食',
          description: '直隶山东河南相继告饥，流民南输，道殣相望，地方既忧生计，又虞教匪乘隙。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '设厂以工代赈', effects: { people: 7, economy: 3, silver: -200, food: -250 }, nextChainNodeId: 'node-3' },
            { id: 'b', label: '劝分借粮于富户', effects: { politics: 4, economy: -3, people: 2 } },
            { id: 'c', label: '驱遣游民勒令回籍', effects: { military: 2, people: -6, politics: 2 } }
          ]
        }
      },
      {
        nodeId: 'node-3',
        triggerTurnOffset: 2,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '捐纳与吏治',
          description: '赈需孔亟，户部广开捐输，异途人员填塞仕版，名器一滥，日后考成吏治俱难。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '力陈捐纳之弊请止', effects: { politics: 6, reputation: 5, economy: -3 } },
            { id: 'b', label: '趁势筹饷以济时艰', effects: { economy: 5, silver: 300, politics: -4 } },
            { id: 'c', label: '择要举办不废常经', effects: { politics: 2, reputation: 2, economy: 2 } }
          ]
        }
      }
    ]
  },

  // ============ 19. 朝鲜壬午甲申（1882-1885，3 节点）============
  // 中法链与甲午链之间原本整段空白：朝鲜宗藩问题只有"前置 yang-wu"一条孤线，此链补其因。
  {
    chainId: 'ren-wu-jia-shen',
    title: '朝鲜壬午甲申',
    description: '属邦两遭兵变，清军入京定乱，日本随之要挟，朝鲜自属国渐成两国角力之场。',
    startYear: 1882,
    endYear: 1885,
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '壬午兵变',
          description: '朝鲜戍兵因粮饷不给鼓噪入宫，杀大臣及王族，王妃匿民间，国王上疏请天兵救援。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '迅派劲旅定其乱', effects: { military: 8, reputation: 6, diplomacy: 3, troops: -200 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '缓师观望使其自敉', effects: { diplomacy: -4, reputation: -3, silver: 150 } },
            { id: 'c', label: '仅遣使臣诘问', effects: { politics: 2, diplomacy: -2 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: ['node-3'],
        isLastNode: false,
        event: {
          title: '甲申政变',
          description: '开化党劫国王改政，三日而败，将弁带营入宫扶翼，日韩交涉随即而起，袁世凯之名由此显。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '出兵速平复其国王', effects: { military: 6, reputation: 8, troops: -150, diplomacy: -3 }, nextChainNodeId: 'node-3' },
            { id: 'b', label: '与日同心退兵', effects: { diplomacy: 5, politics: 3, reputation: -4 } },
            { id: 'c', label: '守成宪不勤远略', effects: { diplomacy: -3, military: -2, economy: 2 } }
          ]
        }
      },
      {
        nodeId: 'node-3',
        triggerTurnOffset: 2,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '朝鲜派兵合同',
          description: '中日订约：两国派兵朝鲜须先行文知照，宗藩名分第一次与邻邦对等，属国之体自此渐弛。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '力争册封旧典独尊', effects: { diplomacy: -5, politics: 5, reputation: 3 } },
            { id: 'b', label: '依约互文知照', effects: { diplomacy: 6, economy: 2, politics: -3 } },
            { id: 'c', label: '密练新兵为东顾备', effects: { military: 6, silver: -200, troops: -100 } }
          ]
        }
      }
    ]
  },

  // ============ 20. 甲申易枢（1884，2 节点，前置 yang-wu-yun-dong）============
  {
    chainId: 'jia-shen-yi-shu',
    title: '甲申易枢',
    description: '恭亲王并全班军机一日而去，新进者平庸畏谨，时论谓中兴之局实转于是。',
    startYear: 1884,
    endYear: 1885,
    prerequisiteChainIds: ['yang-wu-yun-dong'],
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '恭亲王罢',
          description: '言路承风交章弹劾，亲贤并用之局骤改，枢垣尽换，老成谋国者俱退，政事无所统纪。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '直言极谏争大局', effects: { reputation: 6, politics: -3, diplomacy: -2 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '结纳新贵以自固', effects: { politics: 5, reputation: -4 } },
            { id: 'c', label: '引疾退避不预枢要', effects: { economy: 2, reputation: -2 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '枢臣平庸边事棘',
          description: '法越之事日亟而庙算无人，海防江防各为其是，兵饷二端俱无统筹之人。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '条陈统筹防务', effects: { military: 5, politics: 4, reputation: 3, silver: -150 } },
            { id: 'b', label: '请速筹兵饷', effects: { economy: 4, military: 3, silver: -200 } },
            { id: 'c', label: '坐视中枢无人', effects: { diplomacy: -3, politics: -4, reputation: 2 } }
          ]
        }
      }
    ]
  },

  // ============ 21. 中葡北京条约（1887-1888，2 节点）============
  {
    chainId: 'zhong-gu-ao-men',
    title: '中葡北京条约',
    description: '以鸦片税厘并征为换，许葡永驻管理澳门，界址终未勘定，东南海疆多一既成之局。',
    startYear: 1887,
    endYear: 1888,
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '永管澳门之议',
          description: '为办洋药税厘并征，葡使要求许其永驻管理澳门，署议章程，衙门内外争议不断。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '坚拒文字不许永管', effects: { diplomacy: -4, politics: 5, reputation: 3 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '签约并索税厘', effects: { economy: 6, diplomacy: 5, reputation: -4, silver: 250 } },
            { id: 'c', label: '借约防他国窥伺', effects: { diplomacy: 3, military: 2, economy: 2 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '界址终未勘定',
          description: '约虽换而界未勘，关闸以内官督商办之事渐非我所能过问，华民税务两受其扰。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '催勘界址定久远', effects: { politics: 4, diplomacy: 3, silver: -80 } },
            { id: 'b', label: '增筑炮台固前哨', effects: { military: 5, diplomacy: -3, silver: -200 } },
            { id: 'c', label: '一仍其旧不加深究', effects: { diplomacy: 2, politics: -3, reputation: -2 } }
          ]
        }
      }
    ]
  },

  // ============ 22. 大婚与亲政（1889，2 节点，前置 jia-shen-yi-shu）============
  // 戊戌链的前因：帝党后党之分起于大婚亲政，此链填补 1889 空档并为 1898 之变张本。
  {
    chainId: 'guang-xu-da-hun',
    title: '大婚与亲政',
    description: '皇帝大婚、亲政、训政三事同时并举，典礼靡费与归政之名相激，帝后两府之势由此而分。',
    startYear: 1889,
    endYear: 1889,
    prerequisiteChainIds: ['jia-shen-yi-shu'],
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '皇帝大婚',
          description: '拣选皇后，大典采办衣色皮革器物，所费不訾，部款支绌而言官交章请撙节。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '撙节备采以杜中饱', effects: { economy: 5, politics: 4, reputation: 3, silver: -100 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '丰备典礼以彰国体', effects: { reputation: 6, politics: 3, silver: -300 } },
            { id: 'c', label: '请速归政以定根本', effects: { politics: 5, reputation: 4, diplomacy: -3 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '亲政犹训政',
          description: '亲政之礼既成，太后仍训政，凡用人行政大典悉禀懿旨，新进言官渐为帝党，枢臣多附后府。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '调和两宫以安大局', effects: { politics: 6, reputation: 5, diplomacy: 3 } },
            { id: 'b', label: '阴附后府以固其位', effects: { politics: 7, reputation: -5 } },
            { id: 'c', label: '力陈变计以佐新政', effects: { politics: 5, reputation: 3, economy: 3 } }
          ]
        }
      }
    ]
  },

  // ============ 23. 兴中会前夜（1892-1894，2 节点）============
  // 甲午之役同年发生的"革命暗流"：与甲午链分工明确——那条讲战争，这条讲鼎革之谋始于何处。
  {
    chainId: 'xing-zhong-hui',
    title: '兴中会前夜',
    description: '布衣上书不遇，乃悟和平无可复施；华侨集会香山海外，鼎革之谋实肇基于此。',
    startYear: 1892,
    endYear: 1894,
    nodes: [
      {
        nodeId: 'node-1',
        triggerTurnOffset: 0,
        nextNodeIds: ['node-2'],
        isLastNode: false,
        event: {
          title: '上书不遇',
          description: '粤人孙文自乡里历港澳习西医，撰书数千言条陈致富强之本，辗转投呈当轴，竟不获一当。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '延揽人才以备非常', effects: { reputation: 4, politics: 3, silver: -100 }, nextChainNodeId: 'node-2' },
            { id: 'b', label: '主农商立国之本', effects: { economy: 5, people: 3, politics: 2 } },
            { id: 'c', label: '以其布衣而忽之', effects: { reputation: -3, people: -2, politics: 2, silver: 100 } }
          ]
        }
      },
      {
        nodeId: 'node-2',
        triggerTurnOffset: 1,
        nextNodeIds: [],
        isLastNode: true,
        event: {
          title: '檀香山集会',
          description: '海外华侨立会，以驱除鞑虏、恢复中国、创立合众政府为誓，会党、学堂与商埠暗通声气。',
          eventType: '历史剧情',
          options: [
            { id: 'a', label: '密察其党报知其谋', effects: { politics: 5, reputation: 3, military: 2, silver: -100 } },
            { id: 'b', label: '申饬海防杜其内衅', effects: { military: 4, politics: 3, silver: -200 } },
            { id: 'c', label: '引为同调默加护持', effects: { reputation: 5, diplomacy: 2, politics: -4 } }
          ]
        }
      }
    ]
  }
]
