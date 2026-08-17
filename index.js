// Ito yung "starting point" ng buong backend natin.
// Pag na-type mo ang "node index.js" sa terminal, dito nagsisimula lahat.

require('dotenv').config(); // basahin muna ang .env file bago gumawa ng kahit ano

const express = require('express');
// Si "Express" ay isang library na nagpapadali sa paggawa ng web server.
// Sa halip na sulatin natin mismo mula zero kung paano tumanggap ng
// requests mula sa browser, ginagamit na lang natin ang Express.

const path = require('path');
// Ginagamit natin ito mamaya para ma-hanap nang tama ang folder ng project natin,
// kahit saan pa i-deploy (local computer man o Render).

require('./db'); // pina-patakbo natin ang db.js, para kumonekta agad sa database

const app = express();
// Ito yung "server" natin. Dito natin ilalagay lahat ng settings at routes.

const PORT = process.env.PORT || 3000;
// Sa aling "pinto" (port) makikita ang server natin. Kung walang nakalagay
// sa .env, gagamit tayo ng 3000 bilang default.
// (Sa Render, awtomatiko silang magbibigay ng sariling PORT — kaya importante
// na "process.env.PORT" muna ang susundin natin, hindi hardcoded na 3000.)

app.use(express.json());
// Ito ang nagpapahintulot sa server na maintindihan ang data na ipinapadala
// mula sa mga fetch() calls natin sa frontend (yung JSON data mula sa forms).

app.use(express.static(path.join(__dirname, '')));
// Ipinapakita nito ang lahat ng HTML/CSS/JS files natin diretso sa browser.
// Kaya kapag pumunta ka sa localhost:3000/Registration.html, makikita mo agad ito.

app.use('/api/auth', require('./routes/auth'));
// Dito natin sinasabi: "kapag may papasok na request papuntang /api/auth/...,
// ipasa mo sa routes/auth.js — doon nakalagay ang mga specific na logic
// para sa register, login, verify-otp."

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/LoginPage.html');
}); 


app.listen(PORT, () => {
  console.log(`Server is running http://localhost:${PORT}`);
});
// Sa dulo, sinasabi natin sa server na "simulan mo nang makinig sa mga
// papasok na requests" — dito talaga nagsisimulang tumakbo ang lahat.

