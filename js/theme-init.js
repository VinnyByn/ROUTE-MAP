// Aplica o tema salvo (claro/escuro) antes da página desenhar, evitando o "piscar" de tema.
// Carregado sem defer no <head> de index.html e login.html.
(function () {
  try {
    var theme = localStorage.getItem('routeMapTheme');
    if (theme !== 'dark' && theme !== 'light') theme = 'light';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
