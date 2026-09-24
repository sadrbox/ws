// pdf.js ловит эту ошибку и работает без canvas в Node; в браузере модуль не загружается вовсе.
throw new Error("@napi-rs/canvas отключён (frontend/stubs/napi-rs-canvas)");
