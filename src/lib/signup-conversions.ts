export function firstTimeSignupEventWhere<TWhere extends object>(
  where: TWhere
): TWhere & { isRecurring: false } {
  return {
    ...where,
    isRecurring: false,
  };
}
