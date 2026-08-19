from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

IGNORED_TITLE_PREFIXES = (
    "项目销售日报表",
    "订单时间",
    "已售总数量",
    "已售总张数",
    "合计",
)


def col_to_index(ref: str) -> int:
    letters = re.sub(r"\d", "", ref)
    value = 0
    for char in letters:
        value = value * 26 + (ord(char.upper()) - 64)
    return value - 1


def load_sheet_rows(path: Path) -> list[list[str]]:
    with ZipFile(path) as zf:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for item in root.findall("a:si", NS):
                shared_strings.append("".join(node.text or "" for node in item.iterfind(".//a:t", NS)))

        sheet = ET.fromstring(zf.read("xl/worksheets/sheet1.xml"))
        rows: list[list[str]] = []
        for row in sheet.find("a:sheetData", NS).findall("a:row", NS):
            cells = {}
            max_index = -1
            for cell in row.findall("a:c", NS):
                ref = cell.attrib.get("r", "")
                index = col_to_index(ref)
                max_index = max(max_index, index)
                value_node = cell.find("a:v", NS)
                value = "" if value_node is None else value_node.text or ""
                if cell.attrib.get("t") == "s" and value != "":
                    value = shared_strings[int(value)]
                cells[index] = value.strip()
            rows.append([cells.get(i, "") for i in range(max_index + 1)] if max_index >= 0 else [])
        return rows


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def parse_meta(meta: str) -> tuple[str, str, str]:
    clean = normalize_text(meta)
    venue_match = re.search(r"场地：\s*(.*?)\s*场次时间：", clean)
    time_match = re.search(r"场次时间：\s*([0-9-]+)\s+([0-9:]+)", clean)
    venue = venue_match.group(1).strip() if venue_match else ""
    date = time_match.group(1).strip() if time_match else ""
    time = time_match.group(2).strip() if time_match else ""
    return venue, date, time


def weekday_cn(date_text: str) -> str:
    names = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
    dt = datetime.strptime(date_text, "%Y-%m-%d")
    return names[dt.weekday()]


def to_number(value: str):
    if value == "":
        return ""
    number = float(value)
    if number.is_integer():
        return int(number)
    return number


def build_rows(sheet_rows: list[list[str]]) -> list[dict]:
    result: list[dict] = []
    current_type = ""

    for index, row in enumerate(sheet_rows):
        first = normalize_text(row[0]) if row else ""
        if not first:
            continue

        next_first = normalize_text(sheet_rows[index + 1][0]) if index + 1 < len(sheet_rows) and sheet_rows[index + 1] else ""

        if (
            "场次时间" not in first
            and not first.startswith(IGNORED_TITLE_PREFIXES)
            and first != "小计"
            and first != "日期"
            and next_first.startswith("场地：")
        ):
            current_type = first
            continue

        if not first.startswith("场地："):
            continue

        venue, date_text, time_text = parse_meta(first)
        header_row = sheet_rows[index + 2] if index + 2 < len(sheet_rows) else []
        has_gift = any(normalize_text(cell) == "赠票" for cell in header_row)
        total_index = 3 if has_gift else 2

        subtotal = None
        for cursor in range(index + 1, len(sheet_rows)):
            cursor_first = normalize_text(sheet_rows[cursor][0]) if sheet_rows[cursor] else ""
            if cursor_first == "小计":
                subtotal = sheet_rows[cursor]
                break
            if cursor > index + 1 and cursor_first.startswith("场地："):
                break

        if not subtotal or len(subtotal) <= total_index:
            continue

        subtotal_value = to_number(subtotal[total_index])
        result.append(
            {
                "date": date_text,
                "weekday": weekday_cn(date_text) if date_text else "",
                "time": time_text,
                "type": current_type,
                "venue": venue,
                "subtotal_tickets": subtotal_value,
            }
        )

    result.sort(key=lambda item: (item["date"], item["time"], item["type"], item["venue"]))
    return result


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: parse_maizuo_daily_report.py <input.xlsx> <output.json>")

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    rows = build_rows(load_sheet_rows(input_path))
    output_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"parsed_rows={len(rows)}")


if __name__ == "__main__":
    main()
