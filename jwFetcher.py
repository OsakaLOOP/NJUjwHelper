import requests
import json
import math
import time
import re
import webview
import threading
import http.cookies
from backend.cookie_manager import CookieManager

# ================= 配置常量 =================
TARGET_URL = "https://ehallapp.nju.edu.cn/jwapp/sys/kcbcx/modules/qxkcb/qxfbkccx.do"
GATEWAY_URL = "https://ehallapp.nju.edu.cn/jwapp/sys/kcbcx/*default/index.do"

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
        核心算法：生成时间位图列表 和 结构化会话数据
        Returns:
           bitmap: List[str], index=周次 (0不使用), value=当周的位掩码(字符串格式, 避免整数溢出)
           sessions: List[dict], 包含结构化的时间地点信息
        位掩码规则: Day(0-6) * 13 + Node(0-12) -> 对应 Bit 置 1
        """
        # 初始化：0周不用，1-max_weeks 周
        semester_schedule = [0] * (max_weeks + 1)
        sessions = []
        
        if not location_text:
            return [str(x) for x in semester_schedule], sessions

        # 处理多个时间段，通常用分号分隔
        segments = re.split(r'[,;]', location_text)

        for seg in segments:
            matches = list(ScheduleBitmapper.REGEX_PATTERN.finditer(seg))
            if not matches:
                continue

            is_odd_only = "(单)" in seg
            is_even_only = "(双)" in seg
            
            # 尝试从 seg 中提取地点信息 (移除匹配的时间部分)
            # 这是一个简单的 heuristic，可能不完美
            location_part = seg
            for m in matches:
                location_part = location_part.replace(m.group(0), "")
            location_part = location_part.replace("(单)", "").replace("(双)", "").strip()

            for match in matches:
                day_char, start_node, end_node, week_range_str = match.groups()

                day_idx = WEEKDAY_MAP.get(day_char, 0)
                s_node = int(start_node)
                e_node = int(end_node)
                active_weeks = ScheduleBitmapper.parse_week_ranges(week_range_str)

                # Filter active weeks based on odd/even
                filtered_weeks = []
                for w in active_weeks:
                    if 0 < w <= max_weeks:
                        if is_odd_only and (w % 2 == 0): continue
                        if is_even_only and (w % 2 != 0): continue
                        filtered_weeks.append(w)

                if not filtered_weeks:
                    continue

                # Store structured session
                sessions.append({
                    "day": day_idx,
                    "start": s_node,
                    "end": e_node,
                    "weeks": filtered_weeks,
                    "location": location_part
                })

                # 1. 计算这一条时间规则在“单周”内的掩码 (Base Mask)
                segment_mask = 0
                for node in range(s_node, e_node + 1):
                    # 假设每天13节课，位置 = 天*13 + (节-1)
                    # Bit 0 = 周一第1节
                    bit_pos = (day_idx * 13) + (node - 1)
                    segment_mask |= (1 << bit_pos)

                # 2. 将掩码填充到具体的周次中
                for w in filtered_weeks:
                    semester_schedule[w] |= segment_mask
                    
        # Convert bitmaps to string to prevent JS overflow
        return [str(x) for x in semester_schedule], sessions

class LoginInterceptor:
    """基于 pywebview 的登录与 Cookie 嗅探"""
    def __init__(self, toast_callback=None):
        self._cookies = None
        self._window = None
        self.cookie_manager = CookieManager()
        self.toast_callback = toast_callback

    def _toast(self, msg, type='info'):
        if self.toast_callback:
            self.toast_callback(msg, type)

    def _check_login_status(self, window):
        # 轮询检测 URL 是否包含业务系统特征且不包含认证中心特征
        while True:
            time.sleep(0.5)
            try:
                current_url = window.get_current_url()
            except:
                break

            if current_url and "ehallapp.nju.edu.cn" in current_url and "authserver" not in current_url:
                # 获取 Cookies (Webview > 5.0 API)
                time.sleep(3) # 等待新的 cookie 注入完成
                cookies = window.get_cookies()
                pairs = ["EMAP_LANG=zh"]
                for c in cookies:
                    try:
                        if isinstance(c, http.cookies.SimpleCookie):
                            for key, morsel in c.items():
                                pairs.append(f"{key}={morsel.value}")
                        else:
                            # pywebview 6.x returns dict-like objects usually
                            # Assuming it might be a dict or object with properties
                            # Adjusting parsing logic to be more robust
                            try:
                                # Try accessing as object attributes (common in some versions)
                                key = getattr(c, 'name', None) or c.get('name')
                                value = getattr(c, 'value', None) or c.get('value')
                                if key:
                                    pairs.append(f"{key}={value}")
                            except:
                                print(f"[Warn] Cannot parse cookie item: {c}")

                    except Exception as e:
                        print(f"[Error] Parsing cookie failed: {c} - {e}")
                self._cookies = "; ".join(pairs)
                self.cookie_manager.save_cookie(self._cookies)
                self._toast("登录成功，Cookie已更新", "success")
                break
        self._window.destroy()
        
    def validate_cookie(self, cookie_str):
        print("[Cookie] Checking validity...")
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            "Cookie": cookie_str
        }
        try:
            # Follow redirects to see if we land on authserver
            resp = requests.get(GATEWAY_URL, headers=headers, timeout=3, allow_redirects=True)

            # If redirected to authserver, it's invalid
            if "authserver.nju.edu.cn" in resp.url:
                print(f"[Cookie] Invalid: Redirected to login page.")
                self._toast("会话已过期, 请手动删除./Cookies/cookies.txt, 然后重新启动, 记得保存.", "error")
                return False

            # Double check content just in case
            if "统一身份认证" in resp.text or "账号登录" in resp.text:
                print(f"[Cookie] Invalid: Login markers found in response.")
                self._toast("会话无效，需要清除 cookie 并重新登录", "error")
                return False

            print(f"[Cookie] Valid.")
            # self._toast("会话有效", "success") # Too noisy? Maybe
            return True
        except Exception as e:
            print(f"[Cookie] Validation network error: {e}")
            self._toast(f"网络错误: {e}", "error")
            return False
        
    def get_cookie(self):
        # Try loading existing cookie first
        existing_cookie = self.cookie_manager.load_cookie()
        if existing_cookie:
            if self.validate_cookie(existing_cookie):
                return existing_cookie
            else:
                print("[Cookie] Expired or invalid. Clearing...")
                self.cookie_manager.clear_cookie()

        return self.force_login()

    def force_login(self):
        self._window = webview.create_window(
            "NJU Unified Auth - Please Login", 
            GATEWAY_URL,
            width=500, height=600, resizable=False
        )
        # 在独立线程中运行检测逻辑，防止阻塞 UI
        threading.Thread(target=self._check_login_status, args=(self._window,), daemon=True).start()
        webview.start()
        return self._cookies

class NJUCourseClient:
    def __init__(self, cookie_str=None, toast_callback=None, lazy_init=False):
        self.toast_callback = toast_callback
        self.interceptor = LoginInterceptor(toast_callback=toast_callback)
        self.headers = {
            "Host": "ehallapp.nju.edu.cn",
            "Origin": "https://ehallapp.nju.edu.cn",
            "Referer": "https://ehallapp.nju.edu.cn/jwapp/sys/kcbcx/*default/index.do",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        }

        if cookie_str:
            self.headers["Cookie"] = cookie_str
        elif not lazy_init:
            self.ensure_active_session()

    def ensure_active_session(self):
        cookie_str = self.interceptor.get_cookie()
        if not cookie_str:
            cookie_str = self.interceptor.force_login()
        self.headers["Cookie"] = cookie_str

    def _get_campus_display(self, code):
        """辅助：补全后端强制要求的 value_display"""
        mapping = {"1": "鼓楼校区", "2": "浦口校区", "3": "仙林校区", "4": "苏州校区"}
        return mapping.get(code, "未知校区")

    def _toast(self, msg, type='info'):
        if self.toast_callback:
            self.toast_callback(msg, type)

    def search(self, course_name=None, course_code=None, campus="1", semester="2025-2026-1", match_mode="OR"):
        """
        分页拉取所有符合条件的数据
        match_mode: "OR" (任意匹配) 或 "AND" (全部匹配) - 仅对 course_name 有效
        """
        all_data = []
        page = 1
        page_size = 20 # 你要求的默认值
        
        # 1. 构造查询结构 (QuerySetting)
        query_list = []
        
        # --- 动态参数 ---
        if course_name:
            names = course_name.split()
            if len(names) > 1:
                if match_mode == "AND":
                    # AND 逻辑：添加多个独立条件
                    for name in names:
                        query_list.append({
                            "name": "KCM", "caption": "课程名", "linkOpt": "AND",
                            "builderList": "cbl_String", "builder": "include", "value": name
                        })
                else:
                    # OR 逻辑：使用嵌套列表
                    # 结构: [[{name: KCM, value: A, linkOpt: AND}, {name: KCM, value: B, linkOpt: OR}, ...]]
                    kcm_group = []
                    for i, name in enumerate(names):
                        opt = "AND" if i == 0 else "OR"
                        kcm_group.append({
                            "name": "KCM",
                            "caption": "课程名",
                            "linkOpt": opt,
                            "builderList": "cbl_String",
                            "builder": "include",
                            "value": name
                        })
                    query_list.append([kcm_group])
            else:
                # 单关键词保持原样
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
        self._toast("正在搜索...", "info")
        
        # 用于去重 (计算 content hash)
        seen_hashes = set()

        while True:
            form_data = {
                "CXYH": "true", # 外部 Body 也要带
                "querySetting": json.dumps(query_list),
                "*order": "+KKDWDM,+KCH,+KXH",
                "pageSize": str(page_size),
                "pageNumber": str(page)
            }
            
            # Retry loop for session expiration
            res_json = None
            max_retries = 1
            for attempt in range(max_retries + 1):
                try:
                    resp = requests.post(TARGET_URL, headers=self.headers, data=form_data, timeout=10)
                    res_json = resp.json()
                    break # Success
                except (json.JSONDecodeError, requests.RequestException) as e:
                    if attempt < max_retries:
                         print(f"[Warn] Request failed (Attempt {attempt+1}): {e}")
                         self._toast("会话可能已过期，正在尝试恢复...", "error")
                         self.ensure_active_session()
                         # Continue to next attempt
                    else:
                         print(f"[Error] Request failed after retries: {e}")
                         self._toast(f"查询失败 (网络或会话错误): {e}", "error")
                         return [] # Stop

            if not res_json:
                break

            try:
                block = res_json.get("datas", {}).get("qxfbkccx", {})
                rows = block.get("rows", [])
                total_size = block.get("totalSize", 0)
                
                if page == 1:
                    print(f"    -> 命中总数: {total_size}")
                    if total_size == 0:
                         self._toast("未找到任何课程", "info")
                         break
                    else:
                         self._toast(f"找到 {total_size} 条结果，正在下载...", "info")
                
                # 数据清洗与二进制化
                for row in rows:
                    raw_loc = row.get("YPSJDD", "") or ""
                    teacher = row.get("SKJS") or ""

                    # 过滤 1: 老师和地点全为空 (包括空白字符)
                    if not teacher.strip() and not raw_loc.strip():
                        continue

                    # 调用正则解析器
                    bitmap, sessions = ScheduleBitmapper.generate_bitmap(raw_loc)
                    
                    # Try to extract credit (XF) and hours (XS)
                    try:
                        credit = float(row.get("XF", 0))
                    except:
                        credit = 0.0

                    try:
                        hours = float(row.get("XS", 0))
                    except:
                        hours = 0.0

                    item = {
                        "name": row.get("KCM"),
                        "code": row.get("KCH"),
                        "teacher": teacher,
                        "credit": credit,
                        "hours": hours,
                        "location_text": raw_loc,
                        "school": row.get("PKDWDM_DISPLAY") or row.get("KKDWDM_DISPLAY"),
                        # 输出二进制列表 (核心)
                        "schedule_bitmaps": bitmap,
                        "sessions": sessions
                    }

                    # 过滤 2: 完全一致项目去重
                    # 构造唯一标识 tuple (name, code, teacher, location_text, school)
                    # schedule_bitmaps 是派生数据，不需要加入 hash
                    item_id = (item["name"], item["code"], item["teacher"], item["location_text"], item["school"])
                    if item_id in seen_hashes:
                        continue

                    seen_hashes.add(item_id)
                    all_data.append(item)
                
                print(f"    -> Page {page} download complete ({len(rows)} items processed)")
                

                # 应该用 (page * page_size) >= total_size

                if (page * page_size) >= total_size:
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
    
    # 1. Init client (will auto-load cookie or prompt login)
    client = NJUCourseClient()
    
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
        print(f"    Week 1 Bitmap (String): {week1_mask}")
        print(f"    Sessions: {course['sessions']}")
    
    # 5. 保存
    with open(f"nju_courses_{in_camp}.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("\n完整数据已保存至 'nju_courses_final.json'")