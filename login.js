const SUPABASE_URL = "https://yizwpogwabosuguakyzt.supabase.co"
const SUPABASE_KEY = "sb_publishable_e1pJB18UsEV-o_M43ROi9w_4mS--LrF"

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

async function login(){

const email = document.getElementById("email").value
const password = document.getElementById("password").value

const { data, error } = await supabaseClient.auth.signInWithPassword({
email: email,
password: password
})

if(error){
document.getElementById("message").innerText = "Ошибка входа"
return
}

window.location.href = "index.html"

}
