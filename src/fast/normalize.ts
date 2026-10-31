import type { FastFailure, FastFormInput, FastGender, FastRequest } from "./types";

/**
 * 精简版校验：只查「必填有没有填对」。
 *
 * 刻意不做完整版 normalizer 那些事——不补 nameLength、不补 avoidPopular、
 * 不补 birthStatus、不查辈分字与避讳的死局。精简版里这些字段不存在，
 * 所以没有默认值可补，也没有死局可查。
 */

const HAN = /^[\u4e00-\u9fff]+$/;

function isValidBirthday(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  // 回写比对，挡掉 2024-02-31 这种
  const back = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return back === value;
}

export function normalizeFastInput(
  input: FastFormInput,
): { ok: true; value: FastRequest } | FastFailure {
  const surname = (input.surname ?? "").trim();
  if (!surname) {
    return { ok: false, code: "BAD_INPUT", message: "请填写姓氏" };
  }
  if (!HAN.test(surname) || [...surname].length > 2) {
    return { ok: false, code: "BAD_INPUT", message: "姓氏请填 1～2 个汉字" };
  }

  const gender = (input.gender ?? "").trim();
  if (gender !== "male" && gender !== "female") {
    return { ok: false, code: "BAD_INPUT", message: "请选择性别（男 / 女）" };
  }

  const birthday = (input.birthday ?? "").trim();
  if (birthday && !isValidBirthday(birthday)) {
    return { ok: false, code: "BAD_INPUT", message: "生日格式不对，应为 YYYY-MM-DD" };
  }

  return {
    ok: true,
    value: {
      surname,
      gender: gender as FastGender,
      ...(birthday ? { birthday } : {}),
    },
  };
}
