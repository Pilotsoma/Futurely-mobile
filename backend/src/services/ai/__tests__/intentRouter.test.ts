import { IntentClassificationSchema } from '../intentRouter'

describe('IntentClassificationSchema refine constraint', () => {
  describe('invalid payloads', () => {
    it('rejects allowed:true with complexityScore:null', () => {
      expect(() =>
        IntentClassificationSchema.parse({
          allowed: true,
          intent: 'surface',
          complexityScore: null,
          category: 'basic_academics',
        }),
      ).toThrow()
    })

    it('rejects allowed:false with a non-null complexityScore', () => {
      expect(() =>
        IntentClassificationSchema.parse({
          allowed: false,
          intent: 'surface',
          complexityScore: 42,
          category: 'blocked',
        }),
      ).toThrow()
    })
  })

  describe('valid payloads', () => {
    it('accepts a valid blocked payload (allowed:false, complexityScore:null, category:blocked)', () => {
      const result = IntentClassificationSchema.parse({
        allowed: false,
        intent: 'surface',
        complexityScore: null,
        category: 'blocked',
      })
      expect(result.allowed).toBe(false)
      expect(result.complexityScore).toBeNull()
      expect(result.category).toBe('blocked')
    })

    it('accepts a valid allowed surface payload', () => {
      const result = IntentClassificationSchema.parse({
        allowed: true,
        intent: 'surface',
        complexityScore: 25,
        category: 'study_skills',
      })
      expect(result.allowed).toBe(true)
      expect(result.complexityScore).toBe(25)
    })

    it('accepts a valid off_topic blocked payload (allowed:false, complexityScore:null, category:off_topic)', () => {
      const result = IntentClassificationSchema.parse({
        allowed: false,
        intent: 'surface',
        complexityScore: null,
        category: 'off_topic',
      })
      expect(result.allowed).toBe(false)
      expect(result.complexityScore).toBeNull()
      expect(result.category).toBe('off_topic')
    })
  })
})
