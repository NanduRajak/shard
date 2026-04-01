import { faker } from "@faker-js/faker"

export type FormFieldSpec = {
  name: string
  type: string
  label?: string
  required: boolean
  placeholder?: string
  options?: string[]
}

export type SyntheticFormData = Record<string, string>

function fieldMatches(field: FormFieldSpec, ...keywords: string[]): boolean {
  const haystack = `${field.name} ${field.label ?? ""}`.toLowerCase()
  return keywords.some((keyword) => haystack.includes(keyword))
}

export function generateSyntheticValue(field: FormFieldSpec): string {
  // Select with options — pick random
  if (field.type === "select" && field.options?.length) {
    return faker.helpers.arrayElement(field.options)
  }

  // Type-based matching
  switch (field.type) {
    case "email":
      return faker.internet.email()
    case "tel":
      return faker.phone.number()
    case "url":
      return faker.internet.url()
    case "number":
      return faker.number.int({ min: 1, max: 100 }).toString()
    case "date":
      return faker.date.past().toISOString().split("T")[0]
    case "password":
      return faker.internet.password({ length: 12 })
  }

  // Name/label-based matching
  if (fieldMatches(field, "email")) return faker.internet.email()
  if (fieldMatches(field, "phone", "tel")) return faker.phone.number()
  if (fieldMatches(field, "first", "fname")) return faker.person.firstName()
  if (fieldMatches(field, "last", "surname", "lname")) return faker.person.lastName()
  if (fieldMatches(field, "username", "user")) return faker.internet.username()
  if (fieldMatches(field, "name")) return faker.person.fullName()
  if (fieldMatches(field, "company", "org")) return faker.company.name()
  if (fieldMatches(field, "address", "street")) return faker.location.streetAddress()
  if (fieldMatches(field, "city")) return faker.location.city()
  if (fieldMatches(field, "zip", "postal")) return faker.location.zipCode()
  if (fieldMatches(field, "state", "province")) return faker.location.state()
  if (fieldMatches(field, "country")) return faker.location.country()
  if (fieldMatches(field, "message", "comment", "description", "bio")) return faker.lorem.sentence()
  if (fieldMatches(field, "password", "pass")) return faker.internet.password({ length: 12 })
  if (fieldMatches(field, "date", "dob", "birthday")) return faker.date.past().toISOString().split("T")[0]
  if (fieldMatches(field, "search", "query", "q")) return faker.lorem.words(2)

  return faker.lorem.word()
}

export function generateFormData(fields: FormFieldSpec[]): SyntheticFormData {
  const data: SyntheticFormData = {}
  for (const field of fields) {
    data[field.name] = generateSyntheticValue(field)
  }
  return data
}
