export function adminPage(csrfToken: string, nonce: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScrapCook · Private usage</title>
<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;background:#faf9f5;color:#23382c;font:15px/1.5 system-ui,sans-serif}
main{max-width:960px;margin:48px auto;padding:0 20px}h1{font:36px Georgia,serif;margin:8px 0}h2{font-size:18px}
.muted{color:#68736c}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px 0}
.card,.history{background:white;border:1px solid #e1e6df;border-radius:18px;padding:24px}.value{font-size:28px;font-weight:700}
.warning{color:#b42318;font-weight:600}.history{margin-bottom:20px;overflow:auto}table{width:100%;border-collapse:collapse;text-align:left}
td,th{padding:12px 0;border-bottom:1px solid #e7eae5}td:last-child,th:last-child{padding-left:16px}
button{background:#139f49;color:white;border:0;border-radius:12px;padding:12px 20px;font:inherit;font-weight:600;cursor:pointer}
button:disabled{opacity:.5;cursor:wait}@media(max-width:600px){main{margin:24px auto}.cards{grid-template-columns:1fr}.card{padding:18px}h1{font-size:30px}}
</style></head><body><main>
<span class="muted">SCRAPCOOK · OWNER ONLY</span><h1>Private recipe usage</h1>
<p class="muted">Today: <strong id="date">Loading…</strong> · UTC (resets at midnight UTC)</p>
<p id="pause" class="warning" role="alert" hidden></p>
<button id="resume" hidden disabled>Force Resume (I accept charges)</button>
<div class="cards"><section class="card"><h2>Spoonacular</h2><div class="value" id="spoon">—</div><p class="muted">API calls today</p></section>
<section class="card"><h2>Gemini</h2><div class="value" id="gemini">—</div><p class="muted">API calls today</p></section>
<section class="card"><h2>Total requests today</h2><div class="value" id="total">—</div><p class="muted">Recipe generation requests</p></section></div>
<p id="warning" class="warning" role="alert" hidden></p>
<section class="history"><h2>Last 20 request IPs</h2><table><thead><tr><th>IP address</th><th>Time (Brisbane)</th></tr></thead><tbody id="history"></tbody></table></section>
<button id="reset" disabled>Reset Counter</button><p id="status" class="muted" role="status"></p>
<p class="muted">Counters measure provider calls, including retries—not billed credits. Cached results make no provider calls.
Request totals include unsuccessful generation attempts. Only today's last 20 IPs are kept.
Resetting these display counters does not restore provider quotas or reset protective rate limits.</p>
<p class="muted">Auto-pause protects 150 owner-funded Spoonacular call attempts per UTC day, separately from display counters.
Calls are not billed quota points: some Spoonacular endpoints cost more than one point, so this is not a guaranteed zero-charge cap.
Personal-key calls do not use the shared allowance. Force Resume disables this auto-pause until midnight UTC; other rate limits still apply.</p>
</main><script nonce="${nonce}">
const csrfToken=${JSON.stringify(csrfToken)};
const byId=(id)=>document.getElementById(id);
function render(data){
  const pause=data.pause;
  byId("pause").hidden=!pause?.paused&&!pause?.forceResumed;
  byId("pause").textContent=pause?.paused
    ? "⏸️ APP IS PAUSED - Limit hit at "+new Date(pause.pausedAt).toLocaleTimeString("en-AU",{timeZone:"UTC",hour:"numeric",minute:"2-digit"})+" UTC"
    : pause?.forceResumed ? "Force Resume is active until midnight UTC. Additional provider charges may apply." : "";
  byId("resume").hidden=!pause?.paused;
  byId("resume").disabled=false;
  byId("date").textContent=data.date;
  byId("spoon").textContent=data.spoon+" / "+data.limits.spoon+" used";
  byId("gemini").textContent=data.gemini+" / "+data.limits.gemini+" used";
  byId("total").textContent=data.totalRequests;
  const warnings=[];
  for(const [key,name] of [["spoon","Spoonacular"],["gemini","Gemini"]]){
    const high=data[key]>data.limits[key]*0.8;
    byId(key).classList.toggle("warning",high);
    if(high)warnings.push(name+" is above 80% of its daily reference limit.");
  }
  byId("warning").textContent=warnings.join(" ");
  byId("warning").hidden=!warnings.length;
  byId("history").replaceChildren();
  for(const item of data.recentRequests){
    const row=document.createElement("tr");
    for(const value of [item.ip,new Date(item.timestamp).toLocaleString("en-AU",{timeZone:"Australia/Brisbane"})]){
      const cell=document.createElement("td");cell.textContent=value;row.append(cell);
    }
    byId("history").append(row);
  }
  if(!data.recentRequests.length){const row=document.createElement("tr"),cell=document.createElement("td");cell.colSpan=2;cell.textContent="No requests today.";row.append(cell);byId("history").append(row);}
}
async function load(){
  try{const response=await fetch("/api/admin/usage",{credentials:"same-origin",cache:"no-store"});if(!response.ok)throw new Error();render(await response.json());byId("reset").disabled=false;}
  catch{byId("status").textContent="Usage could not be loaded. Your admin session may have expired.";byId("reset").disabled=true;}
}
byId("reset").addEventListener("click",async()=>{
  if(!confirm("Reset today's counters and recent request history? This does not reset provider quotas or rate limits."))return;
  byId("reset").disabled=true;
  try{const response=await fetch("/api/admin/reset",{method:"POST",credentials:"same-origin",headers:{"X-Admin-CSRF":csrfToken}});if(!response.ok)throw new Error();render(await response.json());byId("status").textContent="Counters reset.";}
  catch{byId("status").textContent="Counters could not be reset. Please reload and try again.";}
  finally{byId("reset").disabled=false;}
});
byId("resume").addEventListener("click",async()=>{
  if(!confirm("Resume shared-key calls until midnight UTC? I accept possible provider charges. Other rate limits still apply."))return;
  byId("resume").disabled=true;
  try{
    const response=await fetch("/api/admin/resume",{method:"POST",credentials:"same-origin",
      headers:{"Content-Type":"application/json","X-Admin-CSRF":csrfToken},body:JSON.stringify({acceptCharges:true})});
    if(!response.ok)throw new Error();
    render(await response.json());byId("status").textContent="Recipes resumed until midnight UTC.";
  }catch{byId("status").textContent="Recipes could not be resumed. Please reload and try again.";}
  finally{byId("resume").disabled=false;}
});
load();
setInterval(()=>{if(!byId("reset").disabled)load();},30000);
</script></body></html>`;
}
