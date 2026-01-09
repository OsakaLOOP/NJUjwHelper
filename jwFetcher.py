import requests
import json
import math
import time
import re

# ================= 配置常量 =================
TARGET_URL = "https://ehallapp.nju.edu.cn/jwapp/sys/kcbcx/modules/qxkcb/qxfbkccx.do"

# 星期映射 (用于位图计算)
WEEKDAY_MAP = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}

class ScheduleBitmapper:
    """
    负责将中文时间地点转化为二进制掩码
    """
    # 捕获组: 1=星期, 2=开始节, 3=结束节, 4=周次(如 "1-10,12")
    REGEX_PATTERN = re.compile(r"周([一二三四五六日])\s*(\d+)-(\d+)节\s*([0-9,-]+)周")

    @staticmethod
    def parse_week_ranges(week_str):
        """解析 '1-16' 或 '1-8,10-16' 为具体的周列表"""
        weeks = set()
        parts = week_str.split(',')
        for part in parts:
            if '-' in part:
                try:
                    s, e = map(int, part.split('-'))
                    weeks.update(range(s, e + 1))
                except: pass
            else:
                try:
                    weeks.add(int(part))
                except: pass
        return sorted(list(weeks))

    @staticmethod
    def generate_bitmap(location_text, max_weeks=25):
        """
        核心算法：生成时间位图列表
        Returns: List[int], index=周次 (0不使用), value=当周的位掩码
        位掩码规则: Day(0-6) * 13 + Node(0-12) -> 对应 Bit 置 1
        """
        # 初始化：0周不用，1-max_weeks 周
        semester_schedule = [0] * (max_weeks + 1)
        
        if not location_text:
            return semester_schedule

        # 处理多个时间段，通常用分号分隔
        # 还要过滤掉地点信息，只保留时间部分，防止正则误判
        # 简单策略：直接对整个字符串扫正则
        matches = ScheduleBitmapper.REGEX_PATTERN.finditer(location_text)
        
        for match in matches:
            day_char, start_node, end_node, week_range_str = match.groups()
            
            day_idx = WEEKDAY_MAP.get(day_char, 0)
            s_node = int(start_node)
            e_node = int(end_node)
            active_weeks = ScheduleBitmapper.parse_week_ranges(week_range_str)
            
            # 1. 计算这一条时间规则在“单周”内的掩码 (Base Mask)
            segment_mask = 0
            for node in range(s_node, e_node + 1):
                # 假设每天13节课，位置 = 天*13 + (节-1)
                # Bit 0 = 周一第1节
                bit_pos = (day_idx * 13) + (node - 1)
                segment_mask |= (1 << bit_pos)
            
            # 2. 将掩码填充到具体的周次中
            for w in active_weeks:
                if 0 < w <= max_weeks:
                    semester_schedule[w] |= segment_mask
                    
        return semester_schedule

class NJUCourseClient:
    def __init__(self, cookie_str):
        self.headers = {
            "Host": "ehallapp.nju.edu.cn",
            "Origin": "https://ehallapp.nju.edu.cn",
            "Referer": "https://ehallapp.nju.edu.cn/jwapp/sys/kcbcx/*default/index.do",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Cookie": cookie_str
        }

    def _get_campus_display(self, code):
        """辅助：补全后端强制要求的 value_display"""
        mapping = {"1": "鼓楼校区", "2": "仙林校区", "3": "苏州校区", "4": "浦口校区"}
        return mapping.get(code, "未知校区")

    def search(self, course_name=None, course_code=None, campus="1", semester="2025-2026-1"):
        """
        分页拉取所有符合条件的数据
        """
        all_data = []
        page = 1
        page_size = 20 # 你要求的默认值
        
        # 1. 构造查询结构 (QuerySetting)
        query_list = []
        
        # --- 动态参数 ---
        if course_name:
            query_list.append({"name": "KCM", "caption": "课程名", "linkOpt": "AND", "builderList": "cbl_String", "builder": "include", "value": course_name})
        
        if course_code:
            query_list.append({"name": "KCH", "caption": "课程号", "linkOpt": "AND", "builderList": "cbl_String", "builder": "include", "value": course_code})
            
        # --- 必选参数 (必须带 value_display 否则后端可能报错) ---
        if campus:
            query_list.append({
                "name": "XXXQDM", "caption": "校区", "linkOpt": "AND", "builderList": "cbl_String", "builder": "equal", 
                "value": campus, "value_display": self._get_campus_display(campus)
            })
            
        if semester:
            # 这里的 display 简单拼接一下，通常只要不为空即可
            display_val = f"{semester.split('-')[0]}-{semester.split('-')[1]}学年 第{semester.split('-')[2]}学期"
            query_list.append({
                "name": "XNXQDM", "caption": "学年学期", "linkOpt": "AND", "builderList": "cbl_m_List", "builder": "m_value_equal", 
                "value": semester, "value_display": display_val
            })

        # --- 系统级必传参数 (Status, User, Order) ---
        query_list.append([[{"name": "RWZTDM", "value": "1", "linkOpt": "and", "builder": "equal"}, {"name": "RWZTDM", "linkOpt": "or", "builder": "isNull"}]])
        query_list.append({"name": "CXYH", "value": True, "linkOpt": "AND", "builder": "equal"})
        query_list.append({"name": "*order", "value": "+KKDWDM,+KCH,+KXH", "linkOpt": "AND", "builder": "m_value_equal"})

        # 2. 分页循环
        print(f"[*] 开始查询: Name={course_name}, Code={course_code}, Campus={campus}...")
        
        while True:
            form_data = {
                "CXYH": "true", # 外部 Body 也要带
                "querySetting": json.dumps(query_list),
                "*order": "+KKDWDM,+KCH,+KXH",
                "pageSize": str(page_size),
                "pageNumber": str(page)
            }
            
            try:
                resp = requests.post(TARGET_URL, headers=self.headers, data=form_data, timeout=10)
                res_json = resp.json()
                
                block = res_json.get("datas", {}).get("qxfbkccx", {})
                rows = block.get("rows", [])
                total_size = block.get("totalSize", 0)
                
                if page == 1:
                    print(f"    -> 命中总数: {total_size}")
                    if total_size == 0: break
                
                # 数据清洗与二进制化
                for row in rows:
                    raw_loc = row.get("YPSJDD", "")
                    # 调用正则解析器
                    bitmap = ScheduleBitmapper.generate_bitmap(raw_loc)
                    
                    item = {
                        "name": row.get("KCM"),
                        "code": row.get("KCH"),
                        "teacher": row.get("SKJS"),
                        "location_text": raw_loc,
                        "school": row.get("PKDWDM_DISPLAY") or row.get("KKDWDM_DISPLAY"),
                        # 输出二进制列表 (核心)
                        "schedule_bitmaps": bitmap 
                    }
                    all_data.append(item)
                
                print(f"    -> Page {page} download complete ({len(rows)} items)")
                
                # 判断是否还有下一页
                if len(all_data) >= total_size:
                    break
                
                page += 1
                time.sleep(0.3)
                
            except Exception as e:
                print(f"[Error] Page {page} failed: {e}")
                break
                
        return all_data

# ================= 主程序入口 =================
if __name__ == "__main__":
    print("=== NJU Course Fetcher & Bitmapper ===")
    
    # 1. 用户输入 Cookie
    cookie_input = input("请输入完整的 Cookie 字符串: ").strip()
    if not cookie_input:
        print("Cookie 不能为空")
        exit()
        
    client = NJUCourseClient(cookie_input)
    
    # 2. 用户输入筛选条件 (留空则忽略)
    in_name = input("课程名 (如 '微积分', 可空): ").strip()
    in_code = input("课程号 (如 '06000030', 可空): ").strip()
    in_camp = input("校区代码 (1=鼓楼, 2=仙林, 默认1): ").strip() or "1"
    in_sem  = input("学期 (默认 2025-2026-1): ").strip() or "2025-2026-1"
    
    # 3. 执行
    results = client.search(in_name, in_code, in_camp, in_sem)
    
    # 4. 结果展示 (演示二进制)
    print(f"\n=== 结果预览 (共 {len(results)} 条) ===")
    for idx, course in enumerate(results[:3]): # 只打印前3条防止刷屏
        print(f"\n[{idx+1}] {course['name']} ({course['code']}) | {course['teacher']}")
        print(f"    地点: {course['location_text']}")
        # 演示第一周的二进制
        week1_mask = course['schedule_bitmaps'][1]
        print(f"    Week 1 Bitmap (Int): {week1_mask}")
        print(f"    Week 1 Bitmap (Bin): {bin(week1_mask)}")
    
    # 5. 保存
    with open("nju_courses_final.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("\n完整数据已保存至 'nju_courses_final.json'")