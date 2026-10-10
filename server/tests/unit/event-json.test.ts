import { describe, expect, it } from 'vitest'
import { extractEventJson, extractPartialField } from '../../server/utils/event-json'

/**
 * event-json 单元测试
 *
 * 覆盖流式生成（generate-event?stream=1）下两类解析：
 *   - extractPartialField：未闭合 JSON 的渐进字段提取（用于 UI 渐进显示）
 *   - extractEventJson：完整输出的容错解析（生成结束后的最终结果）
 *
 * 这两个函数出错会直接导致事件拿不到或渐进显示乱码，属于必须守住的核心解析逻辑。
 */
describe('extractPartialField — 从未闭合 JSON 中渐进提取字段', () => {
  it('完整字段可正常读出', () => {
    const json = '{"title":"英法修约之议起","description":"咸丰三年四月"}'
    expect(extractPartialField(json, 'title')).toBe('英法修约之议起')
    expect(extractPartialField(json, 'description')).toBe('咸丰三年四月')
  })

  it('缺结尾引号（生成中）仍读出已生成部分', () => {
    // 模拟流式中断在 description 中间
    const partial = '{"title":"天京定都","description":"太平天国定都天京，局势'
    expect(extractPartialField(partial, 'title')).toBe('天京定都')
    expect(extractPartialField(partial, 'description')).toBe('太平天国定都天京，局势')
  })

  it('字段尚未开始生成时返回空串', () => {
    const partial = '{"title":"天京定都","desc'
    expect(extractPartialField(partial, 'description')).toBe('')
  })

  it('字段不存在时返回空串', () => {
    const json = '{"title":"天京定都"}'
    expect(extractPartialField(json, 'notExist')).toBe('')
  })

  it('空输入返回空串', () => {
    expect(extractPartialField('', 'title')).toBe('')
  })

  it('含转义引号的内容可正确还原', () => {
    const json = '{"title":"他说\\"开战\\"","description":"x"}'
    expect(extractPartialField(json, 'title')).toBe('他说"开战"')
  })

  it('多行缩进 JSON 也能匹配', () => {
    const json = '{\n  "title": "英法修约",\n  "description": "遣使来华"\n}'
    expect(extractPartialField(json, 'title')).toBe('英法修约')
  })
})

describe('extractEventJson — 完整输出的容错解析', () => {
  it('纯 JSON 正常解析', () => {
    const text = '{"title":"天京定都","eventType":"军事","options":[]}'
    expect(extractEventJson(text)).toEqual({
      title: '天京定都',
      eventType: '军事',
      options: []
    })
  })

  it('markdown 代码块包裹可解析', () => {
    const text = '```json\n{"title":"天京定都"}\n```'
    expect(extractEventJson(text)).toEqual({ title: '天京定都' })
  })

  it('前后杂文可解析（取首尾花括号之间）', () => {
    const text = '好的，这是事件：\n{"title":"天京定都"}\n希望符合要求！'
    expect(extractEventJson(text)).toEqual({ title: '天京定都' })
  })

  it('无 JSON 对象时返回 null', () => {
    expect(extractEventJson('抱歉，我无法生成')).toBeNull()
  })

  it('空文本或纯空白返回 null', () => {
    expect(extractEventJson('')).toBeNull()
    expect(extractEventJson('   \n  ')).toBeNull()
  })

  it('花括号不匹配时返回 null（避免产生半截对象）', () => {
    expect(extractEventJson('}not-json{')).toBeNull()
  })
})
