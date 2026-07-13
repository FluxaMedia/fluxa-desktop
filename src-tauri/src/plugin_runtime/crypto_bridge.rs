use aes::cipher::block_padding::{NoPadding, Pkcs7};
use aes::cipher::{BlockModeDecrypt, BlockModeEncrypt, KeyInit, KeyIvInit};
use aes::{Aes128, Aes192, Aes256};
use hmac::{Hmac, Mac};
use md5::Md5;
use pbkdf2::pbkdf2_hmac;
use rand::Rng;
use sha1::Sha1;
use sha2::{Digest, Sha256, Sha384, Sha512};

pub fn digest(algorithm: &str, data: &[u8]) -> Result<Vec<u8>, String> {
    Ok(match algorithm {
        "MD5" => Md5::digest(data).to_vec(),
        "SHA1" => Sha1::digest(data).to_vec(),
        "SHA256" => Sha256::digest(data).to_vec(),
        "SHA384" => Sha384::digest(data).to_vec(),
        "SHA512" => Sha512::digest(data).to_vec(),
        other => return Err(format!("unsupported digest algorithm: {other}")),
    })
}

pub fn hmac(algorithm: &str, key: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    macro_rules! hmac_with {
        ($hash:ty) => {{
            let mut mac = Hmac::<$hash>::new_from_slice(key).map_err(|e| e.to_string())?;
            mac.update(data);
            mac.finalize().into_bytes().to_vec()
        }};
    }
    Ok(match algorithm {
        "MD5" => hmac_with!(Md5),
        "SHA1" => hmac_with!(Sha1),
        "SHA256" => hmac_with!(Sha256),
        "SHA384" => hmac_with!(Sha384),
        "SHA512" => hmac_with!(Sha512),
        other => return Err(format!("unsupported HMAC algorithm: {other}")),
    })
}

pub fn pbkdf2(
    password: &[u8],
    salt: &[u8],
    iterations: u32,
    key_size_bits: u32,
    algorithm: &str,
) -> Result<Vec<u8>, String> {
    let out_len = (key_size_bits as usize).div_ceil(8);
    let mut out = vec![0u8; out_len];
    macro_rules! pbkdf2_with {
        ($hash:ty) => {
            pbkdf2_hmac::<$hash>(password, salt, iterations, &mut out)
        };
    }
    match algorithm {
        "MD5" => pbkdf2_with!(Md5),
        "SHA1" => pbkdf2_with!(Sha1),
        "SHA256" => pbkdf2_with!(Sha256),
        "SHA384" => pbkdf2_with!(Sha384),
        "SHA512" => pbkdf2_with!(Sha512),
        other => return Err(format!("unsupported PBKDF2 algorithm: {other}")),
    }
    Ok(out)
}

pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; len];
    rand::rng().fill_bytes(&mut bytes);
    bytes
}

pub fn aes_encrypt(mode: &str, key: &[u8], iv: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    let (base_mode, no_padding) = split_padding(mode);
    match base_mode {
        "AES-CBC" => cbc_encrypt(key, iv, data, no_padding),
        "AES-ECB" => ecb_encrypt(key, data, no_padding),
        "AES-GCM" => gcm_encrypt(key, iv, data),
        other => Err(format!("unsupported AES mode: {other}")),
    }
}

pub fn aes_decrypt(mode: &str, key: &[u8], iv: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    let (base_mode, no_padding) = split_padding(mode);
    match base_mode {
        "AES-CBC" => cbc_decrypt(key, iv, data, no_padding),
        "AES-ECB" => ecb_decrypt(key, data, no_padding),
        "AES-GCM" => gcm_decrypt(key, iv, data),
        other => Err(format!("unsupported AES mode: {other}")),
    }
}

fn split_padding(mode: &str) -> (&str, bool) {
    match mode.strip_suffix("-NoPadding") {
        Some(base) => (base, true),
        None => (mode, false),
    }
}

fn cbc_encrypt(key: &[u8], iv: &[u8], data: &[u8], no_padding: bool) -> Result<Vec<u8>, String> {
    if iv.len() != 16 {
        return Err("AES-CBC requires a 16-byte IV".to_string());
    }
    match key.len() {
        16 => cbc_encrypt_with::<Aes128>(key, iv, data, no_padding),
        24 => cbc_encrypt_with::<Aes192>(key, iv, data, no_padding),
        32 => cbc_encrypt_with::<Aes256>(key, iv, data, no_padding),
        other => Err(format!("unsupported AES key length: {other} bytes")),
    }
}

fn cbc_decrypt(key: &[u8], iv: &[u8], data: &[u8], no_padding: bool) -> Result<Vec<u8>, String> {
    if iv.len() != 16 {
        return Err("AES-CBC requires a 16-byte IV".to_string());
    }
    match key.len() {
        16 => cbc_decrypt_with::<Aes128>(key, iv, data, no_padding),
        24 => cbc_decrypt_with::<Aes192>(key, iv, data, no_padding),
        32 => cbc_decrypt_with::<Aes256>(key, iv, data, no_padding),
        other => Err(format!("unsupported AES key length: {other} bytes")),
    }
}

fn cbc_encrypt_with<C>(key: &[u8], iv: &[u8], data: &[u8], no_padding: bool) -> Result<Vec<u8>, String>
where
    cbc::Encryptor<C>: KeyIvInit + BlockModeEncrypt,
    C: aes::cipher::BlockCipherEncrypt,
{
    let encryptor = cbc::Encryptor::<C>::new_from_slices(key, iv).map_err(|e| e.to_string())?;
    let mut buf = data.to_vec();
    buf.resize(data.len() + 16, 0);
    let result = if no_padding {
        encryptor
            .encrypt_padded::<NoPadding>(&mut buf, data.len())
            .map_err(|e| e.to_string())?
    } else {
        encryptor
            .encrypt_padded::<Pkcs7>(&mut buf, data.len())
            .map_err(|e| e.to_string())?
    };
    Ok(result.to_vec())
}

fn cbc_decrypt_with<C>(key: &[u8], iv: &[u8], data: &[u8], no_padding: bool) -> Result<Vec<u8>, String>
where
    cbc::Decryptor<C>: KeyIvInit + BlockModeDecrypt,
    C: aes::cipher::BlockCipherDecrypt,
{
    let decryptor = cbc::Decryptor::<C>::new_from_slices(key, iv).map_err(|e| e.to_string())?;
    let mut buf = data.to_vec();
    let result = if no_padding {
        decryptor
            .decrypt_padded::<NoPadding>(&mut buf)
            .map_err(|e| e.to_string())?
    } else {
        decryptor
            .decrypt_padded::<Pkcs7>(&mut buf)
            .map_err(|e| e.to_string())?
    };
    Ok(result.to_vec())
}

fn ecb_encrypt(key: &[u8], data: &[u8], no_padding: bool) -> Result<Vec<u8>, String> {
    match key.len() {
        16 => ecb_encrypt_with::<Aes128>(key, data, no_padding),
        24 => ecb_encrypt_with::<Aes192>(key, data, no_padding),
        32 => ecb_encrypt_with::<Aes256>(key, data, no_padding),
        other => Err(format!("unsupported AES key length: {other} bytes")),
    }
}

fn ecb_decrypt(key: &[u8], data: &[u8], no_padding: bool) -> Result<Vec<u8>, String> {
    match key.len() {
        16 => ecb_decrypt_with::<Aes128>(key, data, no_padding),
        24 => ecb_decrypt_with::<Aes192>(key, data, no_padding),
        32 => ecb_decrypt_with::<Aes256>(key, data, no_padding),
        other => Err(format!("unsupported AES key length: {other} bytes")),
    }
}

fn ecb_encrypt_with<C>(key: &[u8], data: &[u8], no_padding: bool) -> Result<Vec<u8>, String>
where
    ecb::Encryptor<C>: aes::cipher::KeyInit + BlockModeEncrypt,
    C: aes::cipher::BlockCipherEncrypt,
{
    let encryptor = ecb::Encryptor::<C>::new_from_slice(key).map_err(|e| e.to_string())?;
    let mut buf = data.to_vec();
    buf.resize(data.len() + 16, 0);
    let result = if no_padding {
        encryptor
            .encrypt_padded::<NoPadding>(&mut buf, data.len())
            .map_err(|e| e.to_string())?
    } else {
        encryptor
            .encrypt_padded::<Pkcs7>(&mut buf, data.len())
            .map_err(|e| e.to_string())?
    };
    Ok(result.to_vec())
}

fn ecb_decrypt_with<C>(key: &[u8], data: &[u8], no_padding: bool) -> Result<Vec<u8>, String>
where
    ecb::Decryptor<C>: aes::cipher::KeyInit + BlockModeDecrypt,
    C: aes::cipher::BlockCipherDecrypt,
{
    let decryptor = ecb::Decryptor::<C>::new_from_slice(key).map_err(|e| e.to_string())?;
    let mut buf = data.to_vec();
    let result = if no_padding {
        decryptor
            .decrypt_padded::<NoPadding>(&mut buf)
            .map_err(|e| e.to_string())?
    } else {
        decryptor
            .decrypt_padded::<Pkcs7>(&mut buf)
            .map_err(|e| e.to_string())?
    };
    Ok(result.to_vec())
}

fn gcm_encrypt(key: &[u8], iv: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes128Gcm, Aes256Gcm, Nonce};

    if iv.len() != 12 {
        return Err("AES-GCM requires a 12-byte IV".to_string());
    }
    let nonce = Nonce::from_slice(iv);
    match key.len() {
        16 => Aes128Gcm::new_from_slice(key)
            .map_err(|e| e.to_string())?
            .encrypt(nonce, data)
            .map_err(|e| e.to_string()),
        32 => Aes256Gcm::new_from_slice(key)
            .map_err(|e| e.to_string())?
            .encrypt(nonce, data)
            .map_err(|e| e.to_string()),
        other => Err(format!("unsupported AES-GCM key length: {other} bytes")),
    }
}

fn gcm_decrypt(key: &[u8], iv: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes128Gcm, Aes256Gcm, Nonce};

    if iv.len() != 12 {
        return Err("AES-GCM requires a 12-byte IV".to_string());
    }
    let nonce = Nonce::from_slice(iv);
    match key.len() {
        16 => Aes128Gcm::new_from_slice(key)
            .map_err(|e| e.to_string())?
            .decrypt(nonce, data)
            .map_err(|e| e.to_string()),
        32 => Aes256Gcm::new_from_slice(key)
            .map_err(|e| e.to_string())?
            .decrypt(nonce, data)
            .map_err(|e| e.to_string()),
        other => Err(format!("unsupported AES-GCM key length: {other} bytes")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_sha256_output_is_32_bytes() {
        let mac = hmac("SHA256", b"key", b"The quick brown fox jumps over the lazy dog").unwrap();
        assert_eq!(mac.len(), 32, "HMAC-SHA256 must be 32 bytes, got {}", mac.len());
        let hex: String = mac.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            hex,
            "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
        );
    }
}
