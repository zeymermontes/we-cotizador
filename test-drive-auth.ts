import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { google } from "npm:googleapis@133";

const clientEmail = "generador-we@we-page-app.iam.gserviceaccount.com";
const privateKey = "-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC/fx62ZjC20UYr\ngGRbjIphmrxVV7bCX5fpQu4uEJbHHNVWsedJD0KdKAIiUoEq7vYByYPu5ZG7tA72\n9IUP7S/l2qmFwu35rTyFkDo7jKtoZlmaYwqxWYEL9swl69wBTPWSD3vbhq94ISiz\naBLLOvVj+D2Z7ZxTP2m0iNo69WqSNUtbIK7z+UeegORGPZsunKd2qnBjo0VfXrTq\nTmwY2bEp/JTMF+VqzIU/8rCwMx5jEbudVr1Ak2Z8Rp6mmW1UBOYiDNyV4me6f7Qb\nRNjPTu0ITTCrurjsEvWkNNwu91ra8MuPDeem12R16scY0Ifd0qi/roN++19aW8LX\nBQ3CkQklAgMBAAECggEAKkGFR+990WGVj9TZkGAPSyFnbJeZ4wNQFK9pum17r/07\nUFGafUMqSl6BNgyppw0q6NMMU2OCCH7fjHwBfrWyi5B4NuWAOMeS4tAkIW7VhgiL\nvicbvW3ILZksjDOjDQBr8eqLxLHQN3xtrEULXKAqdQBaq4REqhQEoctPCJKODSvm\nK1S9D2uTkMSYsOlRF5kZaLUD0u3qzWFp7M2U3Geang+g4O76pDCpX6a0li2kGgMk\nepWtg3M6LqpCYIyzbKa65yZmB/lpU9WcP01w2o2PLTvVJm7MZtVHygt75vF5aQ9o\nEZ92WW9aJGK/obZIWucKvz7YQwkwExP7PaBaToHRUwKBgQD2ShD1diarWrc8wxJu\njnBd66PbGp9mhs81Xg20+x6h1NmHDQV1K2me/LjIRUmWNFg8hT01/d61gQAJLg/9\nknfxoP8KfkKO+Nq6GXXNUaFm7ba2X6Q8PmCGm9rJB53T2xCN8AEhlvbJV6PsWU/5\nzlp6wYDc8QWYu33xF4yFu4qWcwKBgQDHDAAPYS/f4828RJ4tKscTMSTu12zCuIQK\nHdymnjItbGAi2KU0tA5VxZw0L1urrnfQDQ9EqahMJuCQw/Sh7TgZSFJwoFkhSWdM\n/xRNR/rVgrh+mBoVYAjKp0AmouCvoBoAKKg+V10xRdNLXHN/letWqJYwz4VddwbY\n6lgFwnZkBwKBgCWyWnwnlG2f2fIL7ZNMa/iEK7VKkuFPewGxHqn30c11VcItBQvV\nFDqIdgP5TvUVl/fTcPYFoIPpdcbx7PKj64XpXYAOqUNW5aucYAKIHwsxEUlCxFGQ\nPpf73PXuG4MkwZjoBlRM1gMlTerMFMiohALMAVxP68pf0DwJnbGObfzvAoGAfGcD\nopkbUtMNwp0gPxp9UYFlk+EQGKM54xjGz1wQAFO7wgulNUtTqkfXWMZAhQyF1YJU\nCJYAmZeywse2HX4lkaeh3sJY8nTuGzFRfvt9yfPpWzW1F6bt17qwXXVu+FUX6wF+\nJXh0xlbduDwP862/aGn1dIw+ziuWG/xbBz6CwAECgYBIeLCuIBc2V7pxvBoHT7rT\nyQlB7kSHuNC00BvnXtE9cdIjUpjeFXIAAoGmE7iyqMwkMEt4jNkgCA9P7TQhIROY\nrDo/oAJzwifrAL3PMgm56NW1s9cydKaptfGCM7m6hYSbfJy72kA8CBGbJll5/Oo6\nTnprUnWrfSCvO1tpID+8kA==\n-----END PRIVATE KEY-----\n";

const auth = new google.auth.JWT(
  clientEmail,
  null,
  privateKey,
  ['https://www.googleapis.com/auth/drive']
);

const drive = google.drive({ version: 'v3', auth });

async function check() {
  try {
    const res = await drive.files.get({ fileId: '11walv9X-q6OW2jRaoyhQbHDUSgcvSIb2' });
    console.log("Root folder access OK:", res.data.name);
    
    // Check template Web
    const res2 = await drive.files.get({ fileId: '1vXcsDuONq2XGXEtYWuQIB1bhnEiTXKDnyEvWg_fAxq' });
    console.log("Template Web access OK:", res2.data.name);
  } catch (err) {
    console.error("API Error:", err.message);
  }
}

check();
