import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv, rowsToObjects } from "@/lib/csv";

test("parses quotes, embedded commas and newlines, escaped quotes, CRLF and a BOM", () => {
  const rows = parseCsv('﻿email,course\r\n"a@x.ac.uk","Law, with ""French"""\r\nb@x.ac.uk,"Multi\nline"\r\n\r\n');
  assert.deepEqual(rows, [["email", "course"], ["a@x.ac.uk", 'Law, with "French"'], ["b@x.ac.uk", "Multi\nline"]]);
});

test("maps flexible header names to fields", () => {
  const { records, matched } = rowsToObjects(parseCsv("Email Address,Student ID,Programme,Fee Status\nx@n.ac.uk,123,Economics,Home"), {
    email: ["email", "email address"],
    student_number: ["student id"],
    course: ["course", "programme"],
    fee_status: ["fee status"],
  });
  assert.deepEqual(matched.sort(), ["course", "email", "fee_status", "student_number"]);
  assert.deepEqual(records[0], { email: "x@n.ac.uk", student_number: "123", course: "Economics", fee_status: "Home" });
});

test("row cap is respected", () => {
  const big = "email\n" + Array.from({ length: 50 }, (_, i) => `s${i}@n.ac.uk`).join("\n");
  assert.equal(parseCsv(big, 10).length, 11);
});
