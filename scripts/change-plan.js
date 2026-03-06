#!/usr/bin/env node
// 사용법: node scripts/change-plan.js <이메일> <플랜>
// 예시: node scripts/change-plan.js user@gmail.com pro

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const [,, email, plan] = process.argv;

if (!email || !plan) {
    console.log('사용법: node scripts/change-plan.js <이메일> <플랜>');
    console.log('플랜: free, basic, pro');
    process.exit(1);
}

if (!['free', 'basic', 'pro'].includes(plan)) {
    console.error(`유효하지 않은 플랜: ${plan} (free/basic/pro 중 선택)`);
    process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    const { data, error } = await supabase
        .from('user_data')
        .update({ plan })
        .eq('email', email)
        .select('email, plan');

    if (error) { console.error('오류:', error.message); process.exit(1); }
    if (!data || data.length === 0) { console.error(`이메일 "${email}"을 찾을 수 없습니다.`); process.exit(1); }

    console.log(`${data[0].email} → ${data[0].plan} 플랜으로 변경 완료`);
})();
