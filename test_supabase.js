import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://cbfblvsasamxuwgcpmtj.supabase.co", "sb_publishable_EEGLPPMa3fIX1aRR6GA3Xw_mF4mh5X0");
async function test() {
  const { data, error } = await sb.from("integration_members").select("*, member:member_subject_id(*)").limit(2);
  console.log(JSON.stringify({ data, error }, null, 2));
}
test();
